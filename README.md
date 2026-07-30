> This application is a work in progress, use at your own risk. Pull requests and contributions are welcome.

## App Store

Apps installed from Lockbox are copied into `Apps/<app-id>/` on the USB drive.
After installation, open the App Store, find the app card, and use `Launch` to
start it from the drive. Uninstall removes that app folder from `Apps/`.

Reinstalling the same app replaces its folder with a fresh copy from the
catalog, so the portable app lands in the right place and stays in sync when
you install again. Lockbox itself updates the same way: rebuild the app,
repackage the USB drive, and the new Lockbox binary plus bundled tools are
copied over the previous ones.

The bundled catalog currently includes portable entries for SumatraPDF, Firefox,
Mozilla Thunderbird, Visual Studio Code, Notepad++, and jq on Windows.