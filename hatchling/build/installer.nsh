; Remove the "start with Windows" entry the app may have added, so uninstalling leaves nothing behind.
; (Updates run the old uninstaller too; the new version re-adds the entry on its first start if enabled.)
!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Hatchling"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "Hatchling"
!macroend
