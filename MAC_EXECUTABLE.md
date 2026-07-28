# Debt Squasher for macOS

Two packages are provided:

- `DebtSquasher-macOS-arm64.tar.gz` — Apple Silicon Macs (M1, M2, M3, M4,
  M5, and later).
- `DebtSquasher-macOS-x64.tar.gz` — Intel Macs.

## First launch

1. Extract the correct `.tar.gz` archive.
2. Open Terminal and change to the extracted folder.
3. Run these commands:

   ```zsh
   chmod +x DebtSquasher "Start Debt Squasher.command"
   xattr -dr com.apple.quarantine .
   ./Start\ Debt\ Squasher.command
   ```

The launcher applies an ad-hoc local signature, starts the private-network
server, and opens the dashboard in the default browser. Keep the Terminal
window open while you are using the app.

## Stop the application

**Close the app in your browser and the server stops on its own** about fifteen
seconds later, leaving nothing running in the background. The delay is there so
a page reload does not stop it, and it stays up while anyone else on your
network still has the app open.

You can also press Control-C in the Terminal window, or close that window.

If no browser window connects within two minutes of launch, the server stops.
To run it as an always-on server for your network, start it with
`--keep-running`, which disables the automatic stop.

The package is built from the official Node.js macOS binary, but the final app
is not signed with an Apple Developer ID. macOS may therefore ask for
confirmation. A paid Apple code-signing and notarization workflow is required
to remove that warning completely.

## Access and network

The first sign-in is:

```text
Username: admin
Password: admin
```

You must replace that password immediately. If macOS asks whether to accept
incoming connections, allow them only on a trusted private network. The
Terminal window prints the address other devices can open.

Do not expose or port-forward the server to the public internet.

## Data

The shared database is stored in:

```text
~/Library/Application Support/DebtSquasher
```

Administrators can use **Data** in the dashboard:

- **Save current plan** writes `DebtSquasherData.dat` beside the
  `DebtSquasher` executable.
- **Load saved plan** restores that file.
- **Reset to blank** clears the financial plan while preserving users.

Share only the original `.tar.gz` package when sending a blank copy to another
person. Do not include your `.dat` file or application-support folder.
