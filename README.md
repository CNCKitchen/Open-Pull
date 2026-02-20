__WORK IN PROGRESS__
# Open-Pull
These are all the files you need, to build your own DIY Universal test machine.

__SUPPORT__ my work via [PATREON](https://www.patreon.com/cnckitchen) or [PayPal](https://www.paypal.me/CNCKitchen).

Watch my YouTube video about it: https://youtu.be/uvn-J8CbtzM

__DISCLAIMER__: This is no professional test equipment! I won't be responsible for any damage that occured due to the data you gathered with this machine. Only use with appropriate safety equipment!
# Build one
## Hardware/CAD
CAD files of the whole assembly are available as stl, step and Fusion360 files.
### Bill of Materials (BOM)
* 2x NEMA 17 Stepper Motors 1.68A, Geared 14:1
* 2x Trapezoidal Lead Screw 10x2 500mm
* 2x Coupling 8/10mm
* 2x Trapezoidal Nut 10x2, Steel
* 2x Trapezoidal Nut with Flange, Brass
* 2x Angular Contact Bearing, 3200 2RS
* 2x Ball Bearing, 6202
* 4x Ball Bearing, 608
* ...

## Electronics
Currently the electronics are only as schematics and as images. I'd be happy if anyone made a PCB design for it for easier use.
### Bill of Materials (BOM)
* 1x Arduino Nano
* 2x A4988 Stepper Motor Driver
* 1x HX711 Load Cell Amplifier
* 1x 24V fan
* 1x 5A 24V Power Supply
* 1x Load Cell of suitable size (AEP TC4 - 5kN in my case)
* ...

## Software
The firmware in `Arduino/OpenPull/OpenPull.ino` now uses non-blocking serial handling, timer-driven step generation, and acceleration/deceleration ramps for smoother motion.

Everything can still be controlled from a serial terminal, and a browser GUI is now included in `WebGUI`.

__UPDATE__: OpenPull Web-Controller(by Iqwertz): https://github.com/Iqwertz/OpenPull-Web-Controller

The general functionality is explained in this video: https://youtu.be/uvn-J8CbtzM
# Commands
* __M10__ `[S1]`: Slow test (default 1mm/min). Optional `S1` enables break-detection speedup.
* __M11__: Manual mode (stop test motion and return to jog mode)
* __M12__: Tare
* __M13__: Modulus test - 1mm/min for 30s, then 25mm/min
* __M14__: Fast test (default 25mm/min)
* __M20__: Set displacement zero at current position
* __M21__: Go to displacement zero
* __M40__ `<mm_per_min>`: Set slow test speed
* __M41__ `<mm_per_min>`: Set fast test speed
* __M42__ `<mm_per_s2>`: Set acceleration/deceleration
* __M43__ `<gain>`: Set load-cell gain factor

# Serial Data Protocol
The firmware emits line-based tagged CSV records:

* `DATA,<timestamp_ms>,<load_N>,<step_position>,<displacement_mm>,<mode>,<speed_steps_per_s>`
* `STATUS,<timestamp_ms>,<code>,<message>`
* `ACK,<timestamp_ms>,<command>,<message>`

This format is designed to be robust for GUI parsing and CSV logging.

# Browser GUI
A browser-based controller is included in `WebGUI`:

* Connect/disconnect over Web Serial
* Start slow/fast/Young's tests
* Live force-time chart
* Current/max load, displacement, and stress
* Tare, set zero, go to zero, and gain calibration control
* CSV export of recorded samples

## Running the GUI
Use a Chromium-based browser (Chrome/Edge) with Web Serial support.

1. Open `WebGUI/index.html` in the browser (or serve the repo locally via a simple HTTP server).
2. Click **Connect** and select the Open-Pull serial port.
3. Configure test type/speed/specimen dimensions and click **START TEST**.
4. Export data with **Export**.
# Evaluation
The data is currently analyzed via [EXCEL sheets](Documents/DataAnalysis.xlsx).

The strain data is captures via an optical extensometer using a standard camera. I explain the procedure in my video, the tracking marker export script can be found in [Documents](Documents).

