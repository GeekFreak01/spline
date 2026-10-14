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
; On an update the folder of the installed version is reused.
DisableDirPage=auto
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
ru.UpdateCaption=Обновление Spline до версии %1
en.UpdateCaption=Updating Spline to version %1
ru.UpdateReady=Установлена версия %1. Она будет заменена версией %2 в той же папке.%n%nВаши проекты, настройки и автосохранение не затрагиваются. Если Spline открыт, он закроется и откроется снова после обновления.
en.UpdateReady=Version %1 is installed. It will be replaced with version %2 in the same folder.%n%nYour projects, settings and autosave are kept. If Spline is open, it will be closed and started again after the update.
ru.UpdatePageName=Всё готово к обновлению
en.UpdatePageName=Ready to update
ru.UpdatePageDescription=Программа установки готова обновить Spline.
en.UpdatePageDescription=Setup is ready to update Spline.
ru.SameVersion=Spline %1 уже установлен. Установить его заново?
en.SameVersion=Spline %1 is already installed. Reinstall it?
ru.Downgrade=Установлена более новая версия Spline (%1). Заменить её старой версией %2?
en.Downgrade=A newer version of Spline (%1) is installed. Replace it with the older version %2?

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
; Update started from inside Spline (/RELAUNCH): start the new version again.
Filename: "{app}\{#AppExe}"; Flags: nowait runasoriginaluser; Check: ShouldRelaunch

[Code]
const
  UninstallKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{6F3B2C1E-8D4A-4E7B-9C21-5A0D3F7E9B42}_is1';

var
  PrevVersion: String;

function ShouldRelaunch: Boolean;
begin
  Result := WizardSilent and (Pos('/RELAUNCH', Uppercase(GetCmdTail)) > 0);
end;

// Version of an already installed Spline ('' when there is none).
function InstalledVersion: String;
begin
  Result := '';
  if not RegQueryStringValue(HKCU, UninstallKey, 'DisplayVersion', Result) then
    if not RegQueryStringValue(HKLM64, UninstallKey, 'DisplayVersion', Result) then
      RegQueryStringValue(HKLM32, UninstallKey, 'DisplayVersion', Result);
end;

function IsUpdate: Boolean;
begin
  Result := PrevVersion <> '';
end;

function InitializeSetup: Boolean;
var
  Cmp: Integer;
  Prev, Cur: Int64;
begin
  Result := True;
  PrevVersion := InstalledVersion;
  if (PrevVersion = '') or WizardSilent then
    Exit;
  if StrToVersion(PrevVersion, Prev) and StrToVersion('{#AppVersion}', Cur) then
  begin
    Cmp := ComparePackedVersion(Cur, Prev);
    if Cmp = 0 then
      Result := MsgBox(FmtMessage(CustomMessage('SameVersion'), [PrevVersion]), mbConfirmation, MB_YESNO) = IDYES
    else if Cmp < 0 then
      Result := MsgBox(FmtMessage(CustomMessage('Downgrade'), [PrevVersion, '{#AppVersion}']), mbConfirmation, MB_YESNO) = IDYES;
  end;
end;

procedure InitializeWizard;
begin
  if IsUpdate then
    WizardForm.Caption := FmtMessage(CustomMessage('UpdateCaption'), ['{#AppVersion}']);
end;

// An update keeps the license, folder and options chosen the first time.
function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := IsUpdate and ((PageID = wpLicense) or (PageID = wpSelectTasks) or (PageID = wpSelectDir));
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if IsUpdate and (CurPageID = wpReady) then
  begin
    WizardForm.PageNameLabel.Caption := CustomMessage('UpdatePageName');
    WizardForm.PageDescriptionLabel.Caption := CustomMessage('UpdatePageDescription');
    WizardForm.ReadyLabel.Caption := FmtMessage(CustomMessage('UpdateReady'), [PrevVersion, '{#AppVersion}']);
    WizardForm.AdjustLabelHeight(WizardForm.ReadyLabel);
  end;
end;
