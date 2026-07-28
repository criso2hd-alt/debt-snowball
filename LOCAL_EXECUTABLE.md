# Debt Squasher — Local Executable

## Start the application

1. Double-click `DebtSquasher.exe`.
2. Keep the console window open while the application is in use.
3. If Windows Firewall asks, allow the app on **Private networks only**.
4. The application opens `http://127.0.0.1:8787` in the default browser.

The console also prints one or more private-network addresses. Other people on
the same Wi-Fi or Ethernet network can open one of those addresses in a browser.

Closing the console window stops the server.

## First sign-in

The initial account is:

```text
Username: admin
Password: admin
```

The starter password only works for initial setup. The application requires a
new password of at least eight characters before showing financial data.

## Manage access

An administrator can select **Users** in the dashboard header to:

- create regular users or additional administrators;
- reset a user's password;
- remove a user's access.

New and reset passwords must be changed by that user at their next sign-in.
Every signed-in user can select **Password** to change their own password.

## Shared data

All authenticated users see and edit the same payoff plan. Browser clients
check for updates every three seconds. If two people save at nearly the same
time, the last completed save wins.

New installations start completely blank. Use **Add account** to enter the
first debt. The `•••` control on an account opens its full editor, where the
name, balances, APR, minimum, due day, and color can be changed or the account
can be removed.

Passwords are salted and hashed. Plain-text passwords are not written to disk.
Sessions are kept in memory and expire after 12 hours; restarting the executable
signs everyone out.

The default data folder is:

```text
%LOCALAPPDATA%\DebtSquasher
```

Back up `debt-squasher-data.json` to preserve the user accounts and shared debt
plan. The app automatically saves a timestamped copy if it detects a corrupted
data file.

## Portable `.dat` file

Administrators can select **Data** in the dashboard header:

- **Save current plan** writes `DebtSquasherData.dat` beside
  `DebtSquasher.exe`.
- **Load saved plan** replaces the shared plan with that file.
- **Reset to blank** removes all debts and sets the extra monthly payment to
  zero. User accounts and passwords are preserved.

The `.dat` file contains debt names, balances, APRs, minimums, due dates, and
the monthly extra payment. It does not contain usernames or password hashes.
The file is readable JSON, so treat it as private financial information.

To share a clean copy of the application, send only `DebtSquasher.exe` (and the
README if desired). Do not include `DebtSquasherData.dat` or the contents of
`%LOCALAPPDATA%\DebtSquasher`. Personal balances are never embedded into the
executable during normal use.

## Password recovery

If the administrator password is lost, open Command Prompt in the executable's
folder and run:

```bat
DebtSquasher.exe --reset-admin
```

This resets the `admin` account to `admin` and requires another password change.
It does not erase the debt plan or other users.

## Optional command-line settings

```bat
DebtSquasher.exe --port=9000
DebtSquasher.exe --data-dir="D:\Debt Squasher Data"
DebtSquasher.exe --no-open
```

The equivalent environment variables are `DEBT_SQUASHER_PORT` and
`DEBT_SQUASHER_DATA_DIR`.

## Network security

This app is intended for a trusted private home or office network. It uses local
HTTP rather than HTTPS.

- Do not expose or port-forward it to the public internet.
- Do not allow it through the firewall on Public networks.
- Use individual accounts and strong passwords.
- Anyone who can reach the computer and port can see the sign-in screen, but
  financial data and management APIs require authentication.

The executable is not code-signed, so Windows may show a publisher warning.
A commercial code-signing certificate is required to remove that warning.

## Build from source

From a Windows development terminal with Node.js 24:

```powershell
npm ci
npm run build:exe
```

The generated application is written to:

```text
release\DebtSquasher.exe
```
