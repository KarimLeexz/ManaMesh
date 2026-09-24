# Vendored browser libraries

Served by our own server instead of a CDN, so visitors' browsers don't contact third parties.
Copied unchanged from npm (only the `sourceMappingURL` comment removed):

| File | Package | Version |
|---|---|---|
| `livekit-client.umd.js` | [livekit-client](https://www.npmjs.com/package/livekit-client) | 2.22.3 |
| `socket.io.min.js` | [socket.io-client](https://www.npmjs.com/package/socket.io-client) | 4.7.2 |

To update: `npm pack livekit-client@<version>` (or socket.io-client), copy `dist/…` here, and
update this table.
