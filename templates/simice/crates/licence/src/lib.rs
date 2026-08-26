//! Offline licence verification.
//!
//! A licence is a signed document the customer can carry on a USB stick. It is
//! verified entirely on the machine — no network, which is the point for an
//! on-premise deployment that may never see the internet.
//!
//! ## Threat model
//!
//! What this stops: editing an expiry date, copying one customer's licence to
//! another machine, forging a licence without the private key, and winding the
//! system clock back to revive an expired licence.
//!
//! What it does NOT stop: someone who patches the binary. Nothing running on
//! hardware you do not control can. The goal is to make honest customers
//! correct, not to defeat a determined attacker.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};

/// Seconds of clock drift tolerated before we call it tampering. Generous, because
/// a laptop that has been asleep or has no RTC battery is not an attacker.
pub const CLOCK_DRIFT_TOLERANCE_SECS: i64 = 24 * 60 * 60;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum LicenceError {
    #[error("licence is malformed: {0}")]
    Malformed(String),
    #[error("licence signature is not valid for this product")]
    BadSignature,
    #[error("licence expired on {expired_on} (grace period exhausted)")]
    Expired { expired_on: i64 },
    #[error("licence is issued to a different machine")]
    WrongMachine,
    #[error("licence is not valid yet (starts {starts_on})")]
    NotYetValid { starts_on: i64 },
    #[error("system clock has moved backwards; licence checks are suspended")]
    ClockTampered,
}

/// The signed payload. Field names are stable: changing one invalidates every
/// licence already issued.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Licence {
    pub id: String,
    pub product: String,
    pub customer: String,
    /// Unix seconds.
    pub issued_at: i64,
    /// Unix seconds. The instant the licence stops being valid.
    pub expires_at: i64,
    /// Extra days the app keeps working after expiry, so a renewal in the post
    /// does not stop a factory line.
    #[serde(default)]
    pub grace_days: u32,
    /// Feature flags this licence unlocks.
    #[serde(default)]
    pub features: Vec<String>,
    /// Hardware fingerprint this licence is bound to. `None` means portable.
    #[serde(default)]
    pub machine: Option<String>,
    /// How many seats a floating licence covers. Enforced by the LAN server.
    #[serde(default = "one")]
    pub seats: u32,
}

fn one() -> u32 {
    1
}

/// What the app should do right now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Status {
    Valid { expires_in_days: i64 },
    /// Past `expires_at` but inside the grace window — run, and warn loudly.
    Grace { days_remaining: i64 },
}

impl Licence {
    fn grace_deadline(&self) -> i64 {
        self.expires_at + i64::from(self.grace_days) * 86_400
    }

    pub fn has_feature(&self, feature: &str) -> bool {
        self.features.iter().any(|f| f == feature)
    }
}

/// A licence file: `base64url(payload).base64url(signature)`.
///
/// One line, copy-pasteable into an email, and tamper-evident: the signature
/// covers the exact payload bytes, so re-serialising with a different date
/// invalidates it.
pub fn encode(licence: &Licence, key: &SigningKey) -> Result<String, LicenceError> {
    let payload =
        serde_json::to_vec(licence).map_err(|e| LicenceError::Malformed(e.to_string()))?;
    let signature = key.sign(&payload);
    Ok(format!(
        "{}.{}",
        URL_SAFE_NO_PAD.encode(&payload),
        URL_SAFE_NO_PAD.encode(signature.to_bytes())
    ))
}

/// Verify the signature and decode. Does NOT check expiry — see [`check`].
pub fn decode(token: &str, key: &VerifyingKey) -> Result<Licence, LicenceError> {
    let (payload_b64, sig_b64) = token
        .trim()
        .split_once('.')
        .ok_or_else(|| LicenceError::Malformed("expected <payload>.<signature>".into()))?;

    let payload = URL_SAFE_NO_PAD
        .decode(payload_b64)
        .map_err(|e| LicenceError::Malformed(e.to_string()))?;
    let sig_bytes = URL_SAFE_NO_PAD
        .decode(sig_b64)
        .map_err(|e| LicenceError::Malformed(e.to_string()))?;

    let sig_array: [u8; 64] = sig_bytes
        .try_into()
        .map_err(|_| LicenceError::Malformed("signature is not 64 bytes".into()))?;

    // Signature first, always. Parsing attacker-controlled JSON before
    // authenticating it hands the parser to the attacker.
    key.verify(&payload, &Signature::from_bytes(&sig_array))
        .map_err(|_| LicenceError::BadSignature)?;

    serde_json::from_slice(&payload).map_err(|e| LicenceError::Malformed(e.to_string()))
}

/// Full check: signature, clock sanity, validity window, machine binding.
///
/// `last_seen` is the newest timestamp the app has ever observed, persisted
/// across runs. If `now` is meaningfully before it, the clock was wound back —
/// the classic way to revive an expired licence.
pub fn check(
    licence: &Licence,
    now: i64,
    last_seen: Option<i64>,
    machine: Option<&str>,
) -> Result<Status, LicenceError> {
    if let Some(seen) = last_seen {
        if now < seen - CLOCK_DRIFT_TOLERANCE_SECS {
            return Err(LicenceError::ClockTampered);
        }
    }

    if now < licence.issued_at - CLOCK_DRIFT_TOLERANCE_SECS {
        return Err(LicenceError::NotYetValid {
            starts_on: licence.issued_at,
        });
    }

    if let Some(bound) = licence.machine.as_deref() {
        // A licence bound to hardware must be presented with that hardware.
        if machine != Some(bound) {
            return Err(LicenceError::WrongMachine);
        }
    }

    if now <= licence.expires_at {
        return Ok(Status::Valid {
            expires_in_days: (licence.expires_at - now) / 86_400,
        });
    }

    if now <= licence.grace_deadline() {
        return Ok(Status::Grace {
            days_remaining: (licence.grace_deadline() - now) / 86_400,
        });
    }

    Err(LicenceError::Expired {
        expired_on: licence.expires_at,
    })
}

/// Verify a token and check it in one step — what the app actually calls.
pub fn verify(
    token: &str,
    key: &VerifyingKey,
    now: i64,
    last_seen: Option<i64>,
    machine: Option<&str>,
) -> Result<(Licence, Status), LicenceError> {
    let licence = decode(token, key)?;
    let status = check(&licence, now, last_seen, machine)?;
    Ok((licence, status))
}

/// Parse the public key baked into the binary at build time.
pub fn public_key_from_hex(hex_key: &str) -> Result<VerifyingKey, LicenceError> {
    let bytes = hex::decode(hex_key.trim())
        .map_err(|e| LicenceError::Malformed(format!("public key: {e}")))?;
    let array: [u8; 32] = bytes
        .try_into()
        .map_err(|_| LicenceError::Malformed("public key is not 32 bytes".into()))?;
    VerifyingKey::from_bytes(&array).map_err(|_| LicenceError::Malformed("bad public key".into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::SigningKey;

    const DAY: i64 = 86_400;
    const NOW: i64 = 1_800_000_000;

    fn keypair() -> (SigningKey, VerifyingKey) {
        let mut rng = rand::rng();
        let signing = SigningKey::generate(&mut rng);
        let verifying = signing.verifying_key();
        (signing, verifying)
    }

    fn licence(expires_at: i64) -> Licence {
        Licence {
            id: "lic_1".into(),
            product: "simbkit".into(),
            customer: "Acme Ltd".into(),
            issued_at: NOW - 30 * DAY,
            expires_at,
            grace_days: 0,
            features: vec!["reports".into()],
            machine: None,
            seats: 1,
        }
    }

    #[test]
    fn a_valid_licence_round_trips_and_verifies() {
        let (sk, vk) = keypair();
        let original = licence(NOW + 30 * DAY);
        let token = encode(&original, &sk).unwrap();

        let (decoded, status) = verify(&token, &vk, NOW, None, None).unwrap();
        assert_eq!(decoded, original);
        assert_eq!(status, Status::Valid { expires_in_days: 30 });
        assert!(decoded.has_feature("reports"));
        assert!(!decoded.has_feature("payroll"));
    }

    #[test]
    fn an_expired_licence_blocks_startup() {
        let (sk, vk) = keypair();
        let token = encode(&licence(NOW - DAY), &sk).unwrap();
        assert_eq!(
            verify(&token, &vk, NOW, None, None).unwrap_err(),
            LicenceError::Expired { expired_on: NOW - DAY }
        );
    }

    #[test]
    fn expiry_is_evaluated_against_the_clock_not_the_token() {
        // The same token is valid today and refused a year from now. This is the
        // property that makes a time-limited licence mean anything.
        let (sk, vk) = keypair();
        let token = encode(&licence(NOW + 30 * DAY), &sk).unwrap();
        assert!(verify(&token, &vk, NOW, None, None).is_ok());
        assert!(verify(&token, &vk, NOW + 365 * DAY, None, None).is_err());
    }

    #[test]
    fn grace_period_keeps_the_app_running_then_stops_it() {
        let (sk, vk) = keypair();
        let mut lic = licence(NOW - DAY);
        lic.grace_days = 7;
        let token = encode(&lic, &sk).unwrap();

        // Expired yesterday + 7 grace days => deadline is NOW + 6 days.
        match verify(&token, &vk, NOW, None, None).unwrap().1 {
            Status::Grace { days_remaining } => assert_eq!(days_remaining, 6),
            other => panic!("expected grace, got {other:?}"),
        }
        // The last hour of grace still runs.
        assert!(verify(&token, &vk, NOW + 6 * DAY, None, None).is_ok());
        // One day past the grace deadline it is over.
        assert!(verify(&token, &vk, NOW + 8 * DAY, None, None).is_err());
    }

    #[test]
    fn a_tampered_expiry_date_fails_the_signature() {
        // The whole point. Edit the payload, keep the signature, get refused.
        let (sk, vk) = keypair();
        let token = encode(&licence(NOW - DAY), &sk).unwrap();
        let (payload_b64, sig) = token.split_once('.').unwrap();

        let mut payload: Licence =
            serde_json::from_slice(&URL_SAFE_NO_PAD.decode(payload_b64).unwrap()).unwrap();
        payload.expires_at = NOW + 10_000 * DAY;
        let forged = format!(
            "{}.{}",
            URL_SAFE_NO_PAD.encode(serde_json::to_vec(&payload).unwrap()),
            sig
        );

        assert_eq!(
            verify(&forged, &vk, NOW, None, None).unwrap_err(),
            LicenceError::BadSignature
        );
    }

    #[test]
    fn a_licence_signed_by_someone_else_is_refused() {
        let (attacker_sk, _) = keypair();
        let (_, our_vk) = keypair();
        let token = encode(&licence(NOW + 30 * DAY), &attacker_sk).unwrap();
        assert_eq!(
            verify(&token, &our_vk, NOW, None, None).unwrap_err(),
            LicenceError::BadSignature
        );
    }

    #[test]
    fn a_machine_bound_licence_does_not_travel() {
        let (sk, vk) = keypair();
        let mut lic = licence(NOW + 30 * DAY);
        lic.machine = Some("fp-this-machine".into());
        let token = encode(&lic, &sk).unwrap();

        assert!(verify(&token, &vk, NOW, None, Some("fp-this-machine")).is_ok());
        assert_eq!(
            verify(&token, &vk, NOW, None, Some("fp-other-machine")).unwrap_err(),
            LicenceError::WrongMachine
        );
        // Presenting no fingerprint at all must not bypass the binding.
        assert_eq!(
            verify(&token, &vk, NOW, None, None).unwrap_err(),
            LicenceError::WrongMachine
        );
    }

    #[test]
    fn an_unbound_licence_runs_anywhere() {
        let (sk, vk) = keypair();
        let token = encode(&licence(NOW + 30 * DAY), &sk).unwrap();
        assert!(verify(&token, &vk, NOW, None, Some("any-machine")).is_ok());
    }

    #[test]
    fn winding_the_clock_back_is_detected() {
        // The obvious attack on an expired licence: set the date back a year.
        let (sk, vk) = keypair();
        let token = encode(&licence(NOW + 30 * DAY), &sk).unwrap();
        let last_seen = Some(NOW);
        assert_eq!(
            verify(&token, &vk, NOW - 365 * DAY, last_seen, None).unwrap_err(),
            LicenceError::ClockTampered
        );
    }

    #[test]
    fn ordinary_clock_drift_is_not_treated_as_tampering() {
        // A laptop with a flat RTC battery is a support call, not an attacker.
        let (sk, vk) = keypair();
        let token = encode(&licence(NOW + 30 * DAY), &sk).unwrap();
        assert!(verify(&token, &vk, NOW - 3600, Some(NOW), None).is_ok());
    }

    #[test]
    fn garbage_is_rejected_without_panicking() {
        let (_, vk) = keypair();
        for bad in ["", "not-a-token", "a.b", "....", "üñî.çødé"] {
            let err = verify(bad, &vk, NOW, None, None).unwrap_err();
            assert!(
                matches!(err, LicenceError::Malformed(_) | LicenceError::BadSignature),
                "unexpected error for {bad:?}: {err:?}"
            );
        }
    }

    #[test]
    fn the_payload_is_authenticated_before_it_is_parsed() {
        // Malformed JSON with a bad signature must fail on the SIGNATURE, not on
        // the parse — otherwise the JSON parser is exposed to unauthenticated input.
        let (_, vk) = keypair();
        let token = format!(
            "{}.{}",
            URL_SAFE_NO_PAD.encode(b"{ this is not json"),
            URL_SAFE_NO_PAD.encode([0u8; 64])
        );
        assert_eq!(verify(&token, &vk, NOW, None, None).unwrap_err(), LicenceError::BadSignature);
    }

    #[test]
    fn public_key_hex_round_trips() {
        let (_, vk) = keypair();
        let hex_key = hex::encode(vk.to_bytes());
        assert_eq!(public_key_from_hex(&hex_key).unwrap(), vk);
        assert!(public_key_from_hex("not-hex").is_err());
        assert!(public_key_from_hex("aabb").is_err());
    }
}
