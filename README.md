# Open-Pull
This are all the files you need to build your own DIY Universal test machine.
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
Software is currently only the Arduino code for the machine itself and very rudamentary and not optimized. Everything is controlled via the serial terminal.
# Run one

