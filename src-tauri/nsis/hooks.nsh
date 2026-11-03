!macro customUnInstall
  MessageBox MB_YESNO|MB_ICONQUESTION "Do you want to keep your application data, settings, and library cache?" /SD IDYES IDYES keep_data
    RMDir /r "$APPDATA\${PRODUCT_NAME}"
    RMDir /r "$LOCALAPPDATA\${PRODUCT_NAME}"
    RMDir /r "$APPDATA\io.femag.aurareader"
    RMDir /r "$LOCALAPPDATA\io.femag.aurareader"
  keep_data:
!macroend

