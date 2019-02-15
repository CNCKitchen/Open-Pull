# Open-Pull
These are all the files you need, to build your own DIY Universal test machine.

__SUPPORT__ my work via [PATREON](https://www.patreon.com/cnckitchen) or [PayPal](https://www.paypal.me/CNCKitchen).

Watch my YouTube video about it: https://youtu.be/rJ9XfXXidW4

__DISCLAIMER__: This is no professional test equipment. I won't be responsible for any damage that occured to to the data you gathered with this machine. Only use with appropriate safety equipment!
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

## Electronics
Currently the electronics are only as schematics and as images. I'd be happy if anyone made a PCB design for it for easier use.
### Bill of Materials (BOM)
* 1x Arduino Nano
* 2x A4988 Stepper Motor Driver
* 1x HX711 Load Cell Amplifier
* 1x 24V fan
* 1x 5A 24V Power Supply
* 1x Load Cell of suitable size (AEP TC4 - 5kN in my case)

## Software
Software is currently only the Arduino code for the machine itself, very rudamentary and not optimized. Everything is controlled via the serial terminal.
The general functionality is explained in this video: https://youtu.be/rJ9XfXXidW4
# Commands
* __M10__: Slow test (1mm/min)
* __M12__: Tare
* __M13__: Modulus test - 1mm/min for 30s, then 25mm/min
* __M14__: Fast test (25mm/min)
# Evaluation
The data is currently analyzed via [EXCEL sheets](Documents/DataAnalysis.xlsx).

