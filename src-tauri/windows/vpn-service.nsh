!include "LogicLib.nsh"

!macro NSIS_HOOK_PREINSTALL
  ; Stop only the ByMeVPN service before replacing its executable. The old
  ; release may not contain a service yet, so first installation is a no-op.
  IfFileExists "$INSTDIR\bymevpn-service.exe" 0 bymevpn_preinstall_done
  DetailPrint "Stopping the ByMeVPN service before updating files..."
  ExecWait '"$INSTDIR\bymevpn-service.exe" --stop' $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP|MB_OK "Could not stop the ByMeVPN service. Close the VPN and retry the update."
    Abort
  ${EndIf}
  bymevpn_preinstall_done:
!macroend

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Installing and starting the ByMeVPN service..."
  IfFileExists "$INSTDIR\bymevpn-service.exe" 0 bymevpn_service_missing
  ExecWait '"$INSTDIR\bymevpn-service.exe" --install' $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP|MB_OK "Could not install the ByMeVPN VPN service. Setup will stop."
    Abort
  ${EndIf}
  Goto bymevpn_service_hook_done
  bymevpn_service_missing:
    MessageBox MB_ICONSTOP|MB_OK "The ByMeVPN service executable was not installed. Setup will stop."
    Abort
  bymevpn_service_hook_done:
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  IfFileExists "$INSTDIR\bymevpn-service.exe" 0 bymevpn_uninstall_done
  DetailPrint "Stopping and removing the ByMeVPN service..."
  ExecWait '"$INSTDIR\bymevpn-service.exe" --uninstall' $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP|MB_OK "Could not safely stop and remove the ByMeVPN service. Setup will stop."
    Abort
  ${EndIf}
  bymevpn_uninstall_done:
!macroend
