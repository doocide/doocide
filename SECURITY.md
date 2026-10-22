# Security

Doocide has no server, so most risks live in the browser: hostile links and files, private data leaking into what people share, forged invites, ballots or results, and anything that makes the page load or send data elsewhere.

## Report a problem

Please report it privately: open the Security tab of this repository and choose **Report a vulnerability**. Please don't open a public issue for it.

Helpful details: what you opened (a link, a file, a template, a shared folder), what happened, and the browser you used. Never include anyone's real decisions or personal data in a report.

## What Doocide guarantees

Each of these has an automated test that fails the build if it breaks. The full rules live in [CLAUDE.md](CLAUDE.md), under the "Never" sections.

### Nothing leaves without you

- No network calls you didn't start. The page loads only itself, its language packs and its templates, all from its own address. No analytics, telemetry, error reporting, remote fonts or third-party scripts. A strict Content-Security-Policy (hashed inline scripts, `connect-src 'self'`) blocks anything else.
- Decision data travels in links only after the `#`, the part browsers never send to a server.
- Every share shows a preview of exactly what's included and what's left out.
- Private notes never leave the device: not in links, files, invites, ballots, results or a shared folder. Backups, which include them, never go in a link or a shared folder.

### Incoming links and files are treated as hostile

- Shown as plain text, never as HTML. Invisible and direction-override characters are removed; right-to-left text still works.
- Size, count, length and nesting limits are checked before and while unpacking, and everything is validated into fresh objects.
- Links carry data, never commands. Someone else's decision opens as a read-only preview, and nothing is saved or merged without your tap.
- Only http and https links are clickable. The real domain shows beside each one, domains in other alphabets are flagged as possible look-alikes, and opening asks first.
- Spreadsheet export escapes cells that start with `=`, `+`, `-` or `@`.

### Deciding together

- Invites are signed with the organizer's device key (ECDSA P-256), and a changed invite is refused. Participants can read a 12-digit code to the organizer, out loud or on a call, to confirm the invite really came from them.
- Ballots are signed. Anonymous ballots carry no name, and their key is made for that one decision: never reused, never derived from another key, so nothing links them across decisions. A person's later ballots must be signed by the same key as their first.
- Ballots are sealed to the organizer (a one-time ECDH P-256 key, HKDF, AES-GCM), so only the browser that made the invite can open them.
- No ballot counts until the organizer approves it. Likely duplicates, and more ballots than expected, are flagged.
- Anonymity locks after the first ballot, and the scoring rules lock once an invite is out. An older invite can't roll a participant's copy back.
- Group results files are signed by the organizer. Participants accept them only when signed by the key from their own signed invite, for that decision, and never older than what they already have.

### Shared folders

- Read or written only when someone taps a button. Doocide never watches or polls a folder.
- Only three kinds of file go in: the signed invite, sealed ballots, and signed results, optionally locked with a passphrase. Unsealed ballots and backups are refused.
- File names carry no names: the start of the decision id, or a random id for ballots.

### Passphrases and keys

- WebCrypto only, with no hand-made cryptography. A passphrase goes through PBKDF2-SHA-256 (600,000 iterations), then AES-GCM with a fresh random IV every time.
- Passphrases are never stored. The library lock keeps only a wrapped data key; a locked results file keeps only a key made from its passphrase.
- Private keys are non-extractable: they can sign or open, but nobody can read them out or copy them.

## What Doocide can't promise

- **Anonymous isn't invisible to the collector.** Anonymous ballots are anonymous to other participants and to anyone who sees the results, but not necessarily to whoever collects them, who may know who sent which link or file. In a shared folder, the cloud service can show who added each file and when.
- **Names aren't verified** unless the organizer compared codes with that person. Until then, the app labels them "self-declared".
- **Sealed ballots need the organizer's browser.** If its storage is cleared before every ballot is in, sealed ballots can't be opened anymore.
- **A share can't be taken back.** Anyone with a link or file, and its passphrase if it's locked, can read what's in it.
- **A forgotten library passphrase can't be recovered.** The only way back in is to erase everything in that browser.
- **A device you can't trust is out of reach.** Doocide can't protect decisions from malware, a compromised browser or someone at an unlocked screen.
