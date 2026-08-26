//! The real transport. Everything else in this crate is unaware of it.

use crate::{Method, Result, SyncError, Transport};
use std::time::Duration;

/// HTTP transport for the sync API.
///
/// `base` is the API root; `/sync` is appended once here rather than at every
/// call site, so a trailing slash in configuration cannot produce `//sync/pull`.
pub struct HttpTransport {
    base: String,
    timeout: Duration,
}

impl HttpTransport {
    pub fn new(api_url: &str) -> Self {
        Self {
            base: format!("{}/sync", api_url.trim_end_matches('/')),
            // A site on a satellite link is slow, not broken. Long enough for
            // that, short enough that a dead server does not wedge the loop
            // until the next interval.
            timeout: Duration::from_secs(30),
        }
    }

    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }
}

impl Transport for HttpTransport {
    fn send(
        &self,
        method: Method,
        path: &str,
        headers: &[(&str, &str)],
        body: Option<String>,
    ) -> Result<(u16, String)> {
        let url = format!("{}{}", self.base, path);
        let agent = ureq::Agent::config_builder()
            .timeout_global(Some(self.timeout))
            .build()
            .new_agent();

        // GET and POST builders are DIFFERENT types in ureq 3 — `WithoutBody`
        // and `WithBody` — so the two paths cannot share one builder. Kept
        // explicit rather than boxed: two short arms beat a trait object.
        let response = match method {
            Method::Get => {
                let mut request = agent.get(&url);
                for (name, value) in headers {
                    request = request.header(*name, *value);
                }
                request.call()
            }
            Method::Post => {
                let mut request = agent.post(&url);
                for (name, value) in headers {
                    request = request.header(*name, *value);
                }
                request.send(body.unwrap_or_default())
            }
        };

        match response {
            Ok(mut response) => {
                let status = response.status().as_u16();
                let text = response
                    .body_mut()
                    .read_to_string()
                    .map_err(|e| SyncError::Transport(e.to_string()))?;
                Ok((status, text))
            }
            // A 4xx/5xx is a STATUS, not a transport failure: the engine turns
            // it into SyncError::Status with the body, which is what makes a
            // 502 read as "the server said 502" rather than a decode error.
            Err(ureq::Error::StatusCode(code)) => Ok((code, String::new())),
            Err(e) => Err(SyncError::Transport(e.to_string())),
        }
    }
}
