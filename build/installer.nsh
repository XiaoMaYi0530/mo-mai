; 墨脉 NSIS installer customization
; 防呆：确保安装目录末尾包含产品名文件夹，防止用户直接装在桌面等位置导致卸载异常

!macro customInit
  ${If} $INSTDIR != ""
    ; 如果用户选择的目录末尾不是墨脉，自动追加
    StrLen $0 "$INSTDIR"
    ${If} $0 > 0
      StrCpy $1 "$INSTDIR" "" -2
      ${If} $1 != "墨脉"
        StrCpy $INSTDIR "$INSTDIR\墨脉"
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend
