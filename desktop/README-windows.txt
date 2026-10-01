SENSON for Windows  (independent tool; not KLA or Lam software)

INSTALL (kit: Senson-kit.zip)
  1. Unzip Senson-kit.zip anywhere (e.g. C:\Tools\Senson-kit). No admin rights needed.
  2. Double-click SETUP-Senson.bat. It downloads the Electron runtime once (about 110 MB from
     github.com), builds Senson\Senson.exe and starts it. Next time just run Senson\Senson.exe.
  Manual setup (if the script or the download is blocked by IT):
     a. Download https://github.com/electron/electron/releases/download/v33.2.1/electron-v33.2.1-win32-x64.zip
     b. Unzip it to a folder named Senson, rename electron.exe to Senson.exe.
     c. Copy the folder "senson-app" from this kit to Senson\resources\app
     d. Run Senson.exe.
     The first time, Windows SmartScreen may say "Windows protected your PC" because the app
     is not code-signed. Click "More info" -> "Run anyway" (or ask IT to allow it).

WHAT IT DOES
  - Shows whether the SensArray FOUP is connected: the USB cable appears in Windows as a network
    adapter on 192.168.10.x. Header shows "FOUP connected" or "FOUP not connected · check USB".
    Senson only looks at the adapter; it never sends anything to the FOUP.
  - Watches a folder for new mission files (.csv / .txt). Default: C:\LAM SensArray.
    When a mission file appears (after the download in the vendor software / Data Viewer export),
    Senson either opens it in Data Viewer automatically or shows a pop-up first.
    Change this in Tools Launcher -> Tools -> Auto-import & connection settings.
  - All analysis: Data Viewer, Wafer Viewer (compare), zones, Go/No-Go, SPC, matching.
  - Export to .csv saves straight into the export folder.
  - Load sensor positions once (Data Viewer -> File -> Load sensor positions...); Senson remembers
    them and uses them for every new mission file with the same sensor count.

WORKFLOW
  1. Connect the laptop to the SensArray FOUP with USB; check the header says "FOUP connected".
  2. Start the mission in the vendor Mission Controller and start the wafer from the tool UI.
  3. When the wafer is back in the FOUP and the data is downloaded and saved to the watch folder,
     Senson opens it (or asks first).

Settings are stored in %APPDATA%\senson\settings.json.
