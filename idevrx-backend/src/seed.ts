// Idempotent: creates the learning paths and the starter lessons if they are missing.
// Re-running never overwrites edits made through the admin API.
import mongoose from "mongoose";
import { config } from "./config.js";
import { LearningPath, Lesson } from "./models.js";

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const PATHS: [string, "Beginner" | "Intermediate" | "Advanced" | "Expert", string][] = [
  ["Arduino Fundamentals", "Beginner", "Boards, pins and sketches. Blink an LED, read a button, drive a servo."],
  ["Electronics Fundamentals", "Beginner", "Voltage, current, resistors and breadboards: enough to wire projects safely."],
  ["ESP32 Development", "Intermediate", "Wi-Fi and Bluetooth projects on the ESP32."],
  ["Robotics Fundamentals", "Beginner", "Sensors, motors, controllers and movement: the parts every robot shares."],
  ["Robotic Arms", "Intermediate", "Joints, servos and kinematics for building and controlling an arm."],
  ["Mobile Robotics", "Intermediate", "Wheeled robots that sense and navigate their surroundings."],
  ["Computer Vision", "Advanced", "Teach a robot to see with a camera and OpenCV."],
  ["ROS2", "Advanced", "The robotics middleware: nodes, topics and packages."],
  ["Humanoid Robotics", "Expert", "Balance, gait and many-joint coordination."],
  ["Advanced Robotics", "Expert", "Planning, mapping and systems integration."],
];

const ROBOTICS: [string, number, string][] = [
  ["Sensors", 6, `A sensor turns something physical, like distance, light or tilt, into an electrical signal a microcontroller can read.

Digital sensors give a simple on or off, such as a limit switch or a PIR motion sensor. Analog sensors give a voltage that changes with the measurement, such as a potentiometer or a light-dependent resistor. Many modules talk over I2C or SPI instead, like the MPU6050 motion sensor.

Common robot sensors: an ultrasonic sensor like the HC-SR04 for distance, an IR sensor for close obstacles, an IMU for orientation, and encoders for wheel speed. Always check a sensor's logic voltage. Connecting a 5V output to a 3.3V board can damage it.`],
  ["Motors", 7, `Robots use three main kinds of motor, and each suits a different job.

DC motors spin continuously. Speed depends on the voltage, which a microcontroller sets with PWM. They are the usual choice for wheels, and gear motors trade speed for torque.

Servos move to a position. A hobby servo reads a pulse of roughly 1 to 2 milliseconds every 20 milliseconds and turns to the matching angle. They suit joints, grippers and small arms.

Stepper motors move in fixed steps, so you can position them precisely without feedback. They suit 3D printers and anything that needs repeatable movement. Check a motor's stall current before choosing a supply.`],
  ["Microcontrollers", 6, `A microcontroller is a small computer on one chip, with pins that read and write signals, an analog-to-digital converter, PWM outputs, timers and serial ports.

The Arduino UNO, built on the ATmega328P, is the easiest place to start. It runs at 5V logic and is well documented. The ESP32 is faster and adds Wi-Fi and Bluetooth, but uses 3.3V logic.

Almost every robot program has the same loop: read the sensors, decide what to do, set the outputs. A pin can only supply a small current, around 20 mA on an UNO, so never power a motor directly from one.`],
  ["Motor Drivers", 7, `A microcontroller pin can't supply the current a motor needs. A motor driver sits between them. It takes a small logic signal and switches a much larger current from a separate motor supply.

An H-bridge, found in drivers like the L298N and TB6612, lets you reverse a DC motor's direction. A PWM signal on the enable pin sets its speed. Stepper motors use dedicated drivers such as the A4988.

Power the motors from their own supply and join the grounds together. Add a capacitor near the driver to smooth spikes. When a motor starts and the board resets, a voltage dip is the usual cause.`],
  ["Control", 8, `Control is how a robot turns what it senses into what it does.

Open-loop control just sends a command and hopes. Closed-loop control measures the result and corrects it. A thermostat is the classic example.

A PID controller is the most common closed-loop method. The P term pushes in proportion to the error, the D term damps overshoot by reacting to how fast the error changes, and the I term removes small leftover error over time. A good tuning order is P first, then D, then I. Keep the loop running at a steady rate, because uneven timing makes tuning much harder.`],
  ["Robot Movement", 7, `Most small wheeled robots use differential drive: two driven wheels, one on each side.

If both wheels turn at the same speed the robot goes straight. If one is faster it curves toward the slower side. If they turn in opposite directions it spins on the spot. A simple mix is left = v - w and right = v + w, where v is forward speed and w is how much to turn left.

Wheels slip and motors differ, so a robot told to drive straight will drift. Encoders or an IMU let you measure the drift and correct it. Start slowly, and make the robot stop when its distance sensor sees something close.`],
];

await mongoose.connect(config.MONGODB_URI);
await LearningPath.syncIndexes();

for (const [i, [title, level, summary]] of PATHS.entries()) {
  const slug = slugify(title);
  await LearningPath.updateOne({ slug }, { $setOnInsert: { slug, title, level, summary, order: i + 1, projectNumbers: [], published: true } }, { upsert: true });
}

const robotics = await LearningPath.findOne({ slug: "robotics-fundamentals" }).lean();
for (const [i, [title, minutes, body]] of ROBOTICS.entries()) {
  const slug = slugify(title);
  await Lesson.updateOne({ path: robotics!._id, slug }, { $setOnInsert: { path: robotics!._id, slug, title, minutes, body, order: i + 1 } }, { upsert: true });
}

console.log(`Seeded ${PATHS.length} paths and ${ROBOTICS.length} lessons.`);
await mongoose.disconnect();
