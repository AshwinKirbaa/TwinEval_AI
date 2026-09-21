# TwinEval AI — Multi-System Access

TwinEval AI uses **one central Node.js server and one SQLite database**. This is the correct portable setup when multiple computers must see the same users, logins, submissions, evaluations, and analytics.

## Architecture

```text
                    Central TwinEval AI Server
                    ┌─────────────────────────┐
Windows / Mac ────► │ Node.js + Express      │
Windows / Mac ────► │ SQLite: twineval.db    │
Windows / Mac ────► │ Python AI + Ollama     │
                    └─────────────────────────┘
```

Only the server computer owns the SQLite database. Client computers use a web browser and never create their own copy of the database.

## Start the server

On the computer that will host TwinEval AI:

- Windows: run `start-windows.bat`
- macOS/Linux: run `./start-macos.sh`

The server prints one or more network URLs such as:

```text
🌐 Network access (other systems):
   http://192.168.1.10:5000
```

## Connect another computer

On another Windows or Mac computer connected to the same network, open the printed URL in Chrome, Edge, Firefox, Brave, or Safari:

```text
http://192.168.1.10:5000
```

Do **not** use `localhost:5000` on the client computer. `localhost` always means that client computer itself.

## User data behavior

All clients talk to the same server, so: 

- A user created on Computer A can log in from Computer B.
- The same user sees the same account data from every client.
- Student submissions and evaluation results remain centralized.
- Teacher-created papers are available to authorized clients.
- Logging in on a second computer creates a separate browser session/token, but it accesses the same server-side account.

## Firewall

If other computers cannot connect, allow inbound TCP port `5000` on the server computer's firewall. Keep the server on a trusted LAN. Do not expose port 5000 directly to the public Internet without HTTPS, a reverse proxy, and production authentication/security hardening.

## Important SQLite rule

Do not place the SQLite database on a network/shared folder and have multiple computers open the `.db` file directly. Only the Node.js server should access `twineval.db`; all other computers must use the HTTP API. This avoids database corruption and locking problems.

## Internet / cloud access

For access from computers outside the local network, deploy the Node.js server on a reachable VPS/cloud host and use HTTPS. The same centralized-database architecture can be retained; the client computers still only need a browser.
