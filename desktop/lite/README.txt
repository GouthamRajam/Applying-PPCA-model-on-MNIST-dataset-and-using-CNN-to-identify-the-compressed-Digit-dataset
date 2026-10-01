SENSON for Windows  (independent tool; not KLA or Lam software)

START
  1. Right-click Senson-Windows.zip -> Extract All. Keep Senson.exe in the extracted folder.
  2. Double-click Senson.exe. Senson opens in its own window (it uses Microsoft Edge, which is
     already part of Windows 10/11; nothing is installed and no admin rights are needed).
  3. The first time, Windows may say "Windows protected your PC" because the app is not
     code-signed: click "More info" -> "Run anyway".
  Tip: right-click Senson.exe -> Send to -> Desktop (create shortcut).
  Senson closes itself about 20 seconds after you close its window.

WHAT IT DOES
  - FOUP connection: the USB link appears in Windows as a network adapter on 192.168.10.x.
    The header shows "FOUP connected" or "FOUP not connected - check USB". Senson only looks
    at the adapter; it never sends anything to the FOUP.
  - Watches a folder for new mission files (.csv / .txt). Default: C:\LAM SensArray (if it
    exists), otherwise Documents\Senson Inbox. When a downloaded mission file appears, Senson
    opens it in Data Viewer automatically or asks first. Change this in Tools Launcher ->
    Tools -> Auto-import & connection settings.
  - All analysis: Data Viewer, Wafer Viewer (compare), zones, Go/No-Go, SPC, matching.
  - Export to .csv saves straight into the export folder.

WORKFLOW
  1. Connect the laptop to the SensArray FOUP with USB; check the header says "FOUP connected".
  2. Start the mission in the vendor Mission Controller and start the wafer from the tool UI.
  3. When the wafer is back in the FOUP and the data is downloaded and saved to the watch
     folder, Senson opens it (or asks first).

Settings: %APPDATA%\Senson\settings.json. Senson uses http://127.0.0.1:47613 on this laptop only.
