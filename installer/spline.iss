; Spline installer (Inno Setup 6).
;
; Build:
;   go build -trimpath -ldflags "-s -w -H=windowsgui" -o dist/spline.exe .
;   iscc /DAppVersion=1.2.3 installer\spline.iss
; Result: dist\Spline-Setup-<version>.exe

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#define AppName "Spline"
#define AppExe "spline.exe"
#define AppURL "https://github.com/GeekFreak01/spline"

[Setup]
; Never change AppId: it links upgrades and the uninstaller to this program.
AppId={{6F3B2C1E-8D4A-4E7B-9C21-5A0D3F7E9B42}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=Spline contributors
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}/issues
AppUpdatesURL={#AppURL}/releases
VersionInfoVersion={#AppVersion}
VersionInfoDescription={#AppName} Setup

; "Install for me only" works without administrator rights; the wizard
; offers "for all users" as well.
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableDirPage=no
DisableProgramGroupPage=yes
AllowNoIcons=yes

ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
ChangesAssociations=yes
CloseApplications=yes

OutputDir=..\dist
OutputBaseFilename=Spline-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes

WizardStyle=modern
SetupIconFile=..\assets\spline.ico
WizardImageFile=wizard.bmp,wizard-2x.bmp
WizardSmallImageFile=wizard-small.bmp,wizard-small-2x.bmp
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
LicenseFile=..\LICENSE

[Languages]
Name: "ru"; MessagesFile: "compiler:Languages\Russian.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
ru.AssocTask=Открывать файлы .sp в Spline (иконка и двойной щелчок)
en.AssocTask=Open .sp files with Spline (icon and double-click)
ru.FileTypeName=Проект Spline
en.FileTypeName=Spline project
ru.ExampleName=Пример проекта
en.ExampleName=Example project

[Tasks]
Name: "assoc"; Description: "{cm:AssocTask}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "..\dist\{#AppExe}"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\LICENSE"; DestDir: "{app}"; DestName: "LICENSE.txt"; Flags: ignoreversion
Source: "..\examples\hello.sp"; DestDir: "{app}\examples"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Registry]
; .sp files: type, icon (resource 2 of spline.exe) and "open" command.
; HKA = current user or all users, depending on the install mode.
Root: HKA; Subkey: "Software\Classes\.sp"; ValueType: string; ValueName: ""; ValueData: "Spline.Project"; Flags: uninsdeletevalue; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\.sp"; ValueType: string; ValueName: "Content Type"; ValueData: "application/x-spline-project"; Flags: uninsdeletevalue; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\.sp\OpenWithProgids"; ValueType: string; ValueName: "Spline.Project"; ValueData: ""; Flags: uninsdeletevalue; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\Spline.Project"; ValueType: string; ValueName: ""; ValueData: "{cm:FileTypeName}"; Flags: uninsdeletekey; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\Spline.Project"; ValueType: string; ValueName: "FriendlyTypeName"; ValueData: "{cm:FileTypeName}"; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\Spline.Project\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"",-2"; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\Spline.Project\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"" ""%1"""; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}"; Flags: uninsdeletekeyifempty
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}\SupportedTypes"; ValueType: string; ValueName: ".sp"; ValueData: ""; Flags: uninsdeletekey

[Run]
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent
