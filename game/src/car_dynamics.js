// Game-tuned handling for the four released vehicles. Forces are shared by all driven wheels.
// Both worlds read this table so switching worlds does not change a vehicle's character.
window.PO_CAR_DYNAMICS = Object.freeze({
  alfa33: Object.freeze({ mass: 1050, drive: 'front', driveForce: 4700, reverseForce: 2200,
    brake: 62, coastBrake: 4, drag: 0.45, grip: 3.2, throttleRise: 3.5, throttleFall: 6,
    steerLow: 0.42, steerHigh: 0.09, steerFadeKmh: 130 }),
  fiat500e: Object.freeze({ mass: 1365, drive: 'front', driveForce: 5700, reverseForce: 2700,
    brake: 72, coastBrake: 11, drag: 0.42, grip: 3.2, throttleRise: 10, throttleFall: 12,
    steerLow: 0.43, steerHigh: 0.085, steerFadeKmh: 115 }),
  mc20: Object.freeze({ mass: 1500, drive: 'rear', driveForce: 14000, reverseForce: 3200,
    brake: 105, coastBrake: 2, drag: 0.40, grip: 4.1, throttleRise: 5.5, throttleFall: 8,
    steerLow: 0.38, steerHigh: 0.075, steerFadeKmh: 170 }),
  atv: Object.freeze({ mass: 410, drive: 'all', driveForce: 2300, reverseForce: 1300,
    brake: 55, coastBrake: 6, drag: 0.85, grip: 4.2, throttleRise: 4, throttleFall: 7,
    steerLow: 0.54, steerHigh: 0.13, steerFadeKmh: 65 }),
});
