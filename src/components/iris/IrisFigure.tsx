import { useMemo } from "react";

// Iris: the dashboard's original mascot. A small walking robot with one camera
// lens for an eye. Drawn in a 200×270 box, in separate parts so each can move.

export type IrisMood = "idle" | "curious" | "alert" | "working" | "proud" | "worried" | "happy";

const SHELL = "#f3f5f8";
const OUTLINE = "#c3cbd4";
const JOINT = "#3a4350";
const EAR = "#d5dbe2";
const EAR_OUTLINE = "#b7c0ca";
const TEAL = "#14a39a";
const AMBER = "#f0a020";
const GREEN = "#43a047";
const RED = "#e53935";

interface Look {
  /** Ring light, antenna and chest light colour. */
  ring: string;
  /** Aperture (pupil) radius, 0 = shut. */
  aperture: number;
  /** Head tilt in degrees. */
  tilt: number;
  /** Ear height: lower = perked up. */
  earY: number;
  /** Body offset: negative = standing tall. */
  dy: number;
  wave: boolean;
  bladeTurn: number;
  zoom: boolean;
}

const LOOKS: Record<IrisMood, Look> = {
  idle: { ring: TEAL, aperture: 9, tilt: 0, earY: 72, dy: 0, wave: false, bladeTurn: 0, zoom: false },
  curious: { ring: TEAL, aperture: 14, tilt: -9, earY: 65, dy: 0, wave: false, bladeTurn: 10, zoom: true },
  alert: { ring: RED, aperture: 4.5, tilt: 0, earY: 63, dy: -2, wave: false, bladeTurn: 20, zoom: false },
  working: { ring: AMBER, aperture: 7, tilt: 7, earY: 70, dy: 0, wave: false, bladeTurn: 35, zoom: false },
  proud: { ring: GREEN, aperture: 10, tilt: -4, earY: 70, dy: -2, wave: false, bladeTurn: 0, zoom: false },
  worried: { ring: AMBER, aperture: 12, tilt: 11, earY: 80, dy: 5, wave: false, bladeTurn: 5, zoom: false },
  happy: { ring: GREEN, aperture: 15, tilt: -7, earY: 66, dy: -3, wave: true, bladeTurn: 15, zoom: false },
};

const LENS_X = 100;
const LENS_Y = 92;

/** Hexagonal aperture plus the seams between the shutter blades. */
function aperture(radius: number, turnDeg: number) {
  const points: string[] = [];
  const seams: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const a = ((i * 60 + 30 + turnDeg) * Math.PI) / 180;
    const b = ((i * 60 + 85 + turnDeg) * Math.PI) / 180;
    const x1 = LENS_X + radius * Math.cos(a);
    const y1 = LENS_Y + radius * Math.sin(a);
    points.push(`${x1.toFixed(2)},${y1.toFixed(2)}`);
    seams.push({ x1, y1, x2: LENS_X + 25 * Math.cos(b), y2: LENS_Y + 25 * Math.sin(b) });
  }
  return { points: points.join(" "), seams };
}

function Limb({ x1, y1, x2, y2, width }: { x1: number; y1: number; x2: number; y2: number; width: number }) {
  return (
    <>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={OUTLINE} strokeWidth={width + 4} strokeLinecap="round" />
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={SHELL} strokeWidth={width} strokeLinecap="round" />
    </>
  );
}

function Gripper({ transform }: { transform: string }) {
  return (
    <g transform={transform}>
      <line x1="0" y1="2" x2="-5" y2="12" stroke={JOINT} strokeWidth="3.5" strokeLinecap="round" />
      <line x1="0" y1="2" x2="5" y2="12" stroke={JOINT} strokeWidth="3.5" strokeLinecap="round" />
    </g>
  );
}

function Leg({ side }: { side: "left" | "right" }) {
  const hipX = side === "left" ? 84 : 116;
  const kneeX = side === "left" ? 80 : 120;
  const footX = side === "left" ? 67 : 101;
  return (
    <g className={`iris-leg iris-leg--${side}`}>
      <Limb x1={hipX} y1={212} x2={kneeX} y2={234} width={11} />
      <Limb x1={kneeX} y1={234} x2={hipX} y2={254} width={9} />
      <circle cx={kneeX} cy={234} r={6} fill={JOINT} />
      <rect x={footX} y={251} width={32} height={11} rx={5.5} fill={JOINT} />
      <circle cx={hipX} cy={212} r={6} fill={JOINT} />
    </g>
  );
}

interface IrisFigureProps {
  mood: IrisMood;
  /** Shutter closed for a moment. */
  blinking?: boolean;
  /** Overrides the mood's arm pose (raised while pushing a card shut). */
  armUp?: boolean;
  walking?: boolean;
}

export function IrisFigure({ mood, blinking = false, armUp, walking = false }: IrisFigureProps) {
  const look = LOOKS[mood];
  const raised = armUp ?? look.wave;
  const lens = useMemo(() => aperture(blinking ? 0 : look.aperture, look.bladeTurn), [blinking, look]);
  const ringR = look.zoom ? 33 : 31;
  const arm = raised
    ? { x: 163, y: 134, grip: "translate(163 134) rotate(200)" }
    : { x: 156, y: 198, grip: "translate(156 198) rotate(-20)" };

  return (
    <svg
      viewBox="0 0 200 270"
      className={`iris-figure${walking ? " iris-figure--walking" : ""}`}
      aria-hidden="true"
      focusable="false"
    >
      <ellipse cx="100" cy="264" rx="54" ry="5" fill="#1b1f24" opacity="0.12" />
      <g className="iris-bob">
        <g className="iris-shift" style={{ transform: `translateY(${look.dy}px)` }}>
          <Leg side="left" />
          <Leg side="right" />

          <Limb x1={60} y1={166} x2={44} y2={198} width={10} />
          <Gripper transform="translate(44 198) rotate(20)" />
          <Limb x1={140} y1={166} x2={arm.x} y2={arm.y} width={10} />
          <Gripper transform={arm.grip} />

          <rect x="60" y="150" width="80" height="62" rx="22" fill={SHELL} stroke={OUTLINE} strokeWidth="2" />
          <circle cx="60" cy="166" r="7" fill={JOINT} />
          <circle cx="140" cy="166" r="7" fill={JOINT} />
          <circle className="iris-light" cx="100" cy="177" r="11" opacity="0.22" style={{ fill: look.ring }} />
          <circle className="iris-light" cx="100" cy="177" r="6.5" style={{ fill: look.ring }} />
          <line x1="86" y1="198" x2="114" y2="198" stroke={OUTLINE} strokeWidth="3" strokeLinecap="round" />
          <rect x="90" y="140" width="20" height="14" rx="4" fill={JOINT} />

          <g className="iris-head" style={{ transform: `rotate(${look.tilt}deg)` }}>
            <line x1="100" y1="42" x2="100" y2="22" stroke={JOINT} strokeWidth="3.5" strokeLinecap="round" />
            <circle className="iris-light" cx="100" cy="17" r="10" opacity="0.22" style={{ fill: look.ring }} />
            <circle className="iris-light" cx="100" cy="17" r="6" style={{ fill: look.ring }} />
            <rect x="25" y={look.earY} width="17" height="36" rx="8.5" fill={EAR} stroke={EAR_OUTLINE} strokeWidth="2" />
            <rect x="158" y={look.earY} width="17" height="36" rx="8.5" fill={EAR} stroke={EAR_OUTLINE} strokeWidth="2" />
            <rect x="38" y="40" width="124" height="104" rx="36" fill={SHELL} stroke={OUTLINE} strokeWidth="2" />
            <rect x="56" y="49" width="38" height="7" rx="3.5" fill="#ffffff" opacity="0.9" />
            <ellipse cx="56" cy="122" rx="7" ry="4" fill="#f2b8b5" opacity="0.75" />
            <ellipse cx="144" cy="122" rx="7" ry="4" fill="#f2b8b5" opacity="0.75" />

            <circle cx={LENS_X} cy={LENS_Y} r="39" fill="#2b313a" />
            <circle className="iris-ring" cx={LENS_X} cy={LENS_Y} r={ringR} fill="none" strokeWidth="10" opacity="0.25" style={{ stroke: look.ring }} />
            <circle className="iris-ring" cx={LENS_X} cy={LENS_Y} r={ringR} fill="none" strokeWidth="4.5" style={{ stroke: look.ring }} />
            <circle cx={LENS_X} cy={LENS_Y} r="25" fill="#323c48" />
            <polygon points={lens.points} fill="#05080c" />
            {lens.seams.map((s, i) => (
              <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="#1c232c" strokeWidth="1.5" />
            ))}
            <ellipse cx="88" cy="80" rx="6.5" ry="4.5" fill="#ffffff" opacity="0.92" />
            <circle cx="111" cy="104" r="2.2" fill="#ffffff" opacity="0.5" />
          </g>
        </g>
      </g>
    </svg>
  );
}
