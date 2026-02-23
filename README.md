# Open-Pull

DIY universal testing machine files (mechanics, electronics, firmware, and browser control UI).

Watch the project video: https://youtu.be/uvn-J8CbtzM

Support: [Patreon](https://www.patreon.com/cnckitchen) · [PayPal](https://www.paypal.me/CNCKitchen)

## Safety + Disclaimer

Open-Pull is a DIY machine and **not certified professional test equipment**.

- Use safety glasses and shielding.
- Keep hands, loose clothing, and tools away from moving parts.
- Verify load limits for frame, grips, motors, drivers, and load cell.
- Validate calibration before collecting any meaningful data.

You are responsible for safe operation and for verifying all measurements.

## Repository Contents

- `Arduino/OpenPull/OpenPull.ino` – firmware for Arduino Nano-compatible target.
- `WebGUI/` – browser-based control and data export app (Web Serial).
- `Electronics/Eagle-Files/` – schematic/board files and custom Eagle library.
- `CAD/TestMachine/` – machine assembly files (`.f3d`, `.step`) and parts.
- `CAD/Specimens/` – specimen CAD models.
- `Documents/DataAnalysis.xlsx` – spreadsheet-based analysis template.
- `Documents/exportTrackingPoints.py` – Blender tracking marker export helper.

## Hardware Overview

Typical build components include:

- 2× geared NEMA17 steppers
- 2× trapezoidal lead screws and nuts
- linear guidance/bearings/couplers/frame hardware
- Arduino Nano
- 2× A4988 stepper drivers
- HX711 load-cell amplifier + suitable load cell
- 24V supply and cooling

Use the CAD and electronics folders as the source of truth for your specific build variant.

## Firmware

Firmware location: `Arduino/OpenPull/OpenPull.ino`

### Key behavior

- Non-blocking serial command handling.
- Timer-driven step generation.
- Ramped acceleration/deceleration.
- Median + exponential filtering for load values.
- Automatic break detection (optional) with optional quick re-tare.
- Persistent config in EEPROM (speeds, accel, gain, sample rate, etc.).

### Firmware dependencies

- Arduino `HX711` library by Bogde (`bogde/HX711`).
- Arduino `EEPROM` (built-in).

### Upload basics

1. Open `Arduino/OpenPull/OpenPull.ino` in Arduino IDE.
2. Select your board/port.
3. Ensure the HX711 library is installed.
4. Compile and upload.

Serial settings: **115200 baud**, newline-terminated commands.

## Command Reference

All commands are ASCII lines terminated with `\n`.

### Motion + test control

- `M10 [S1]` – start slow test. `S1` enables slow-test break-speedup mode.
- `M11` – manual mode / stop active test.
- `M12` – tare load cell.
- `M13` – Young's/modulus profile (slow phase then fast phase).
- `M14` – start fast test.
- `M15` – emergency stop.
- `M20` – set current position as displacement zero.
- `M21` – move to displacement zero.
- `M22 <delta_mm>` – relative jog move.

### Configuration

- `M40 <mm_per_min>` – set slow test speed.
- `M41 <mm_per_min>` – set fast test speed.
- `M42 <mm_per_s2>` – set acceleration.
- `M43 <gain>` – set load-cell gain (**only during unlocked gain window**).
- `M44 <Hz>` – set sample rate.
- `M45 <mm_per_min>` – set manual slow jog speed.
- `M46 <mm_per_min>` – set manual fast jog speed.
- `M47 <N>` – set preload target for slow-test start sequence.
- `M48 <0..1>` – set load filter alpha.
- `M49 <0|1>` – disable/enable auto break detection.
- `M50` – report current config.
- `M51 <0|1>` – disable/enable tare-after-break.
- `M53` – arm gain write window (30s wait + 30s allowed write window).

## Serial Protocol

Firmware emits CSV-like tagged lines:

- `DATA,<timestamp_ms>,<load_N>,<step_position>,<displacement_mm>,<mode>,<speed_steps_per_s>`
- `STATUS,<timestamp_ms>,<code>,<message>`
- `ACK,<timestamp_ms>,<command>,<message>`
- `CFG,<timestamp_ms>,<slow_mm_min>,<fast_mm_min>,<accel_mm_s2>,<gain>,<sample_hz>,<manual_slow_mm_min>,<manual_fast_mm_min>,<preload_n>,<alpha>,<auto_break>,<tare_after_break>`

Mode values:

- `1` slow test
- `2` manual
- `3` fast test
- `4` Young's test
- `5` go-to-zero
- `6` relative move

## Web GUI

GUI location: `WebGUI/index.html`

### Features

- Web Serial connect/disconnect.
- Guided workflow: create series → prepare sample → start test.
- Live chart with selectable axes:
	- X: time or displacement
	- Y: force or stress
- Per-test metadata (name/comment/type/geometry).
- Overlay previous tests in the same series.
- Manual jog buttons (`±0.1`, `±1`, `±10 mm`).
- Tare, zero, goto-zero, stop, and emergency stop.
- Firmware config controls (preload, alpha, sample rate, manual speeds, accel, gain unlock/set, break options).
- Export to XLSX (clean + full variants).
- Local persistence of series state in browser `localStorage`.

### Browser requirements

- Chromium-based browser with Web Serial support (Chrome/Edge).
- USB serial permission to the controller.
- Internet connection if loading the bundled CDN XLSX script as-is.

### Running

1. Open `WebGUI/index.html` in a compatible browser.
2. Click **Connect** and choose the Open-Pull serial port.
3. Click **New Series**.
4. Click **New Sample**, fill sample details, confirm.
5. Set speed/config as needed.
6. Click **START TEST**.
7. Stop with **Stop Test** (`M11`) or **EMERGENCY STOP** (`M15`) if required.
8. Export results with **Clean Export (.xlsx)** or **Full Export (.xlsx)**.

## Data Export

WebGUI provides two spreadsheet exports:

- **Clean Export (.xlsx)**
	- Organized two-column blocks per test (displacement vs stress/force)
	- Includes a `Configuration` sheet
	- Intended for quick plotting and reporting

- **Full Export (.xlsx)**
	- Flat table with full per-sample rows
	- Includes timestamps, load, displacement, mode, speed, and metadata
	- Includes a `Configuration` sheet

`Documents/DataAnalysis.xlsx` can be used for additional analysis workflows.

## Optical Tracking Helper

`Documents/exportTrackingPoints.py` exports Blender tracking marker coordinates to CSV files.

Update the output path inside the script to match your system before running.

## Troubleshooting

- **No serial connection in browser:** use Chrome/Edge and verify Web Serial support/permissions.
- **`hx711_not_ready` status:** check HX711 wiring, power, and load-cell connection.
- **Cannot set gain:** send/use `M53`, wait for unlock delay, then send `M43 <gain>` within the allowed window.
- **Unexpected force spikes/noise:** verify grounding, shielded wiring, stable power, and tuning of filter alpha/sample rate.
- **Inconsistent displacement zero:** run `M20` at known reference and use `M21` for repeatability checks.

## License

This repository is licensed under **GNU GPL v3.0**. See `LICENSE`.

