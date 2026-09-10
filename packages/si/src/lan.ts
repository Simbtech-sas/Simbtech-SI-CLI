import { networkInterfaces } from 'node:os';

/**
 * The address a phone on the same Wi-Fi can reach this machine on.
 *
 * `localhost` is useless from another device, and that is the whole point of
 * testing on a real one: a layout bug, a touch target, a camera permission and
 * an OAuth redirect all behave differently on a phone than in a resized desktop
 * window.
 *
 * Returns undefined when there is no usable address — on a machine with no
 * network, or behind an interface we should not advertise.
 */
export function lanAddress(): string | undefined {
  const candidates: Array<{ address: string; score: number }> = [];

  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      // IPv4 only. A link-local IPv6 needs a zone index that does not survive
      // being typed into a phone, and a QR code of one is a support ticket.
      if (addr.family !== 'IPv4' || addr.internal) continue;

      // Docker and VM bridges are real interfaces with real addresses that no
      // phone can route to. Ranking rather than excluding: on a machine where
      // the only interface IS a bridge, a wrong guess still beats nothing.
      const bridge = /^(docker|br-|veth|virbr|vmnet|vboxnet|tailscale|zt)/.test(name);
      const wireless = /^(wl|wlan|wlp|en0|Wi-?Fi)/i.test(name);
      candidates.push({ address: addr.address, score: (bridge ? -10 : 0) + (wireless ? 2 : 1) });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.address;
}
