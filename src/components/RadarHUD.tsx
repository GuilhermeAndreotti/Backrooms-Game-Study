/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from "react";
import { GameEngine } from "../game/GameEngine";
import { RemotePlayer } from "../types/game";
import { Radio, Crosshair, Compass } from "lucide-react";

interface RadarHUDProps {
  engineRef: React.MutableRefObject<GameEngine | null>;
  /**
   * Live roster read straight from the ref every frame.
   *
   * This used to be a plain array prop. Because the array identity changed with
   * every network packet (~25/s per teammate), the effect below tore down and
   * rebuilt its requestAnimationFrame loop dozens of times a second.
   */
  playersRef: React.MutableRefObject<RemotePlayer[]>;
  level: number;
}

const RadarHUDComponent: React.FC<RadarHUDProps> = ({
  engineRef,
  playersRef,
  level
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [coords, setCoords] = useState({ x: 0.0, z: 0.0 });
  const [vhsSignal, setVhsSignal] = useState("SINAL ESTÁVEL");
  const [headingDegrees, setHeadingDegrees] = useState(0);

  useEffect(() => {
    let running = true;
    let frameId: number;
    let lastUiUpdate = 0;
    let lastDraw = 0;

    // The radar is a second full canvas repaint competing with the 3D renderer
    // for the main thread. It carries no fast-moving detail, so it is capped
    // well below display rate. Read per frame: the engine is created after this
    // effect mounts, and the cap follows the active quality preset.
    const frameBudgetFor = () => 1000 / (engineRef.current?.quality.radarFps ?? 20);

    // Track previous positions and state for player heading direction
    let prevX = 0;
    let prevZ = 0;
    let initializedPrev = false;
    let currentArrowAngle = -Math.PI / 2; // Default looking UP

    const render = () => {
      if (!running) return;
      frameId = requestAnimationFrame(render);

      const nowMs = performance.now();
      if (nowMs - lastDraw < frameBudgetFor()) return;
      lastDraw = nowMs;

      const canvas = canvasRef.current;
      if (!canvas) return;
      
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const width = canvas.width;
      const height = canvas.height;
      const cx = width / 2;
      const cy = height / 2;

      // Reset / Clear canvas with deep dark retro-CRT backrooms green-gold tint
      ctx.fillStyle = "#0c0a05";
      ctx.fillRect(0, 0, width, height);

      const engine = engineRef.current;
      if (!engine || !engine.player || !engine.map) {
        // Render Signal Searching / VHF connecting screen
        ctx.fillStyle = "rgba(222, 184, 29, 0.05)";
        ctx.fillRect(10, 10, width - 20, height - 20);

        ctx.strokeStyle = "rgba(222, 184, 29, 0.2)";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(10, 10, width - 20, height - 20);

        ctx.fillStyle = "#deb81d";
        ctx.font = "bold 11px Courier New, monospace";
        ctx.textAlign = "center";
        ctx.fillText("VHF TELEMETRIA", cx, cy - 20);
        ctx.fillText("RECONECTANDO...", cx, cy);

        // Blinking signal block
        if (Math.sin(Date.now() * 0.007) > 0) {
          ctx.fillRect(cx - 30, cy + 18, 60, 10);
        }
        return;
      }

      const player = engine.player;
      const map = engine.map;
      const px = player.position.x;
      const pz = player.position.z;
      const yaw = player.rotation.y;

      // Track movement vector in local-space coordinates (relative to look rotation)
      const moveDir = player.getMoveDirection();
      let targetAngle = -yaw - Math.PI / 2; // Default looking direction in static world

      if (moveDir && moveDir.lengthSq() > 0.01) {
        // Local movement angle relative to forward (which is at -Math.PI/2)
        const localAngle = Math.atan2(moveDir.z, moveDir.x);
        // Integrate into global world movement orientation on static map
        targetAngle = -yaw - Math.PI / 2 + (localAngle + Math.PI / 2);
      }

      // Smoothly lerp actual arrow heading orientation
      let diffAngle = targetAngle - currentArrowAngle;
      while (diffAngle < -Math.PI) diffAngle += Math.PI * 2;
      while (diffAngle > Math.PI) diffAngle -= Math.PI * 2;
      currentArrowAngle += diffAngle * 0.18; // smooth heading transition response

      // Update coordination state hook periodically (exactly every 400ms) to avoid React rendering noise
      const now = Date.now();
      if (now - lastUiUpdate > 400) {
        lastUiUpdate = now;
        setCoords({ x: px, z: pz });
        
        // Calculate degree (0 to 360)
        // ThreeJS camera facing direction angle
        let deg = Math.round(((-yaw * 180) / Math.PI) % 360);
        if (deg < 0) deg += 360;
        setHeadingDegrees(deg);

        // Signal interference depending on active level and smilers proximity
        if (level === 1 && engine.smilers && engine.smilers.length > 0) {
          let nearestDist = 999;
          engine.smilers.forEach((sm) => {
            const dx = sm.mesh.position.x - px;
            const dz = sm.mesh.position.z - pz;
            const d = Math.sqrt(dx * dx + dz * dz);
            if (d < nearestDist) nearestDist = d;
          });

          if (nearestDist < 8.0) {
            setVhsSignal("CRÍTICO: RUIDO MAGNÉTICO");
          } else if (nearestDist < 18.0) {
            setVhsSignal("SINAL COM INTERFERÊNCIA");
          } else {
            setVhsSignal("VHF FLUTUANTE IPX1");
          }
        } else {
          setVhsSignal(level === 0 ? "NÍVEL 0: AMBIENTE SEGURO" : "SINAL NOMINAL VHF-2");
        }
      }

      // 1. Draw radar circular boundary background
      ctx.fillStyle = "rgba(10, 9, 4, 0.9)";
      ctx.beginPath();
      ctx.arc(cx, cy, cx - 12, 0, Math.PI * 2);
      ctx.fill();

      // 2. Scan lines / Concentric circles
      ctx.strokeStyle = "rgba(222, 184, 29, 0.12)";
      ctx.lineWidth = 1;
      for (let r = 24; r < cx - 12; r += 24) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Draw cross-grid lines
      ctx.beginPath();
      ctx.moveTo(12, cy);
      ctx.lineTo(width - 12, cy);
      ctx.moveTo(cx, 12);
      ctx.lineTo(cx, height - 12);
      ctx.stroke();

      // 2.2 Draw background level designation watermark
      ctx.fillStyle = "rgba(222, 184, 29, 0.08)";
      ctx.font = "bold 9px Courier New, monospace";
      ctx.textAlign = "center";
      
      if (level === 2) {
        ctx.fillText("NÍVEL 2: RUN!", cx, cy - 25);
        ctx.fillText("ALERTA: EVACUAR", cx, cy + 25);
      } else if (level === 0) {
        ctx.fillText("NÍVEL 0: THE LOBBY", cx, cy - 25);
        ctx.fillText("STATUS: SEGURO", cx, cy + 25);
      } else {
        ctx.fillText("NÍVEL 1: HABITABLE", cx, cy - 25);
        ctx.fillText("ANOMALIA PRESENTE", cx, cy + 25);
      }

      // 3. Render Maze Walls
      const maxRange = 26; // Display range (meters)
      const scale = (cx - 12) / maxRange; // map pixels scale factor

      const pCellX = Math.floor(px / map.cellSize);
      const pCellZ = Math.floor(pz / map.cellSize);
      const searchRadius = 7;

      ctx.save();
      ctx.translate(cx, cy);
      // Keep map oriented statically (North at top) for ease of navigation and zero disorientation

      // Draw solid walls
      ctx.fillStyle = "rgba(222, 184, 29, 0.16)";
      ctx.strokeStyle = "rgba(222, 184, 29, 0.4)";
      ctx.lineWidth = 1.0;

      for (let dx = -searchRadius; dx <= searchRadius; dx++) {
        const gx = pCellX + dx;
        if (gx < 0 || gx >= map.gridSize) continue;

        for (let dz = -searchRadius; dz <= searchRadius; dz++) {
          const gz = pCellZ + dz;
          if (gz < 0 || gz >= map.gridSize) continue;

          // Wall blocks are CellType.SOLID (0)
          if (map.grid[gx][gz] === 0) {
            // Find world coordinates of center of this grid cell
            const cellCenterX = gx * map.cellSize + map.cellSize / 2;
            const cellCenterZ = gz * map.cellSize + map.cellSize / 2;

            const rx = cellCenterX - px;
            const rz = cellCenterZ - pz;
            const dist = Math.sqrt(rx * rx + rz * rz);

            if (dist < maxRange + 3) {
              const drawSize = map.cellSize * scale;
              ctx.fillRect(rx * scale - drawSize / 2, rz * scale - drawSize / 2, drawSize - 1, drawSize - 1);
              ctx.strokeRect(rx * scale - drawSize / 2, rz * scale - drawSize / 2, drawSize - 1, drawSize - 1);
            }
          }
        }
      }

      // 4. Render Exit glitch gateway (Level 1 exit portal or Level 0 anomaly exit)
      const hasExit = map.exitGridX !== 0 || map.exitGridZ !== 0;
      if (hasExit) {
        const exitX = map.exitGridX * map.cellSize + map.cellSize / 2;
        const exitZ = map.exitGridZ * map.cellSize + map.cellSize / 2;
        const rx = exitX - px;
        const rz = exitZ - pz;
        const dist = Math.sqrt(rx * rx + rz * rz);

        if (dist < maxRange) {
          const rX = rx * scale;
          const rY = rz * scale;
          const pulse = Math.abs(Math.sin(Date.now() * 0.004));

          ctx.fillStyle = `rgba(34, 197, 94, ${0.4 + pulse * 0.5})`; // green noclip breach signal
          ctx.strokeStyle = "#4ade80";
          ctx.lineWidth = 1.6;

          ctx.beginPath();
          ctx.arc(rX, rY, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = "#4ade80";
          ctx.font = "bold 8px Courier New, monospace";
          ctx.textAlign = "center";
          ctx.fillText("SAÍDA", rX, rY - 8);
        }
      }

      // 5. Draw peer remote player teammates (VHF Transceivers tracked)
      playersRef.current.forEach((p) => {
        // Only render teammates who are currently exploring the same level
        if (p.level !== undefined && p.level !== level) return;

        const rx = p.x - px;
        const rz = p.z - pz;
        const dist = Math.sqrt(rx * rx + rz * rz);

        if (dist < maxRange) {
          const rX = rx * scale;
          const rY = rz * scale;

          ctx.save();
          ctx.translate(rX, rY);
          ctx.rotate(-p.yaw - Math.PI / 2); // face teammates pointing relative orientation

          ctx.fillStyle = "#06b6d4"; // Cyan tracker signal
          ctx.strokeStyle = "#22d3ee";
          ctx.lineWidth = 1;

          ctx.beginPath();
          ctx.moveTo(0, -4);
          ctx.lineTo(3.5, 4);
          ctx.lineTo(-3.5, 4);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();

          // Peer Name Tag
          ctx.fillStyle = "#22d3ee";
          ctx.font = "7px Courier New, monospace";
          ctx.textAlign = "center";
          ctx.fillText(p.name.split(" ")[0].substring(0, 7), rX, rY + 11);
        }
      });

      // 6. Draw active monstrous Entities (SMILERS) in Level 1 (Level 0 strictly has NO entities)
      if (level === 1 && engine.smilers && engine.smilers.length > 0) {
        engine.smilers.forEach((smiler) => {
          const smWX = smiler.mesh.position.x;
          const smWZ = smiler.mesh.position.z;
          const rx = smWX - px;
          const rz = smWZ - pz;
          const dist = Math.sqrt(rx * rx + rz * rz);

          if (dist < maxRange) {
            const rX = rx * scale;
            const rY = rz * scale;

            // Crimson radar interference alarm symbol (creepy blinking warning blip)
            const flash = Math.sin(Date.now() * 0.015) > 0;
            if (flash) {
              ctx.fillStyle = "#ef4444";
              ctx.strokeStyle = "rgba(239, 68, 68, 0.4)";
              
              ctx.beginPath();
              ctx.arc(rX, rY, 5, 0, Math.PI * 2);
              ctx.fill();

              ctx.beginPath();
              ctx.arc(rX, rY, 10, 0, Math.PI * 2);
              ctx.stroke();

              // Hostile tag identifier
              ctx.fillStyle = "#ef4444";
              ctx.font = "bold 7px Courier New, monospace";
              ctx.textAlign = "center";
              ctx.fillText("SMILER", rX, rY - 8);
            }
          }
        });
      }

      // 6.2 Draw Wandering Stalker Entities (High Danger Anomalies)
      if (engine.entities && engine.entities.length > 0) {
        engine.entities.forEach(entity => {
          const entX = entity.mesh.position.x;
          const entZ = entity.mesh.position.z;
          const rx = entX - px;
          const rz = entZ - pz;
          const dist = Math.sqrt(rx * rx + rz * rz);

          if (dist < maxRange) {
            const rX = rx * scale;
            const rY = rz * scale;

            // Highly glitched pulsing radar warning blip
            const pulse = Math.abs(Math.sin(Date.now() * 0.012 + (entity.type === "DULLER" ? 4 : 0)));
            
            let colorFill = "";
            let colorStroke = "";
            let label = "";

            switch (entity.type) {
              case "DULLER":
                colorFill = `rgba(37, 99, 235, ${0.20 + pulse * 0.35})`; // blue-cyan ghostly
                colorStroke = "#60a5fa";
                label = "DULLER (FALHA)";
                break;
              case "HOUND":
                colorFill = `rgba(249, 115, 22, ${0.45 + pulse * 0.55})`; // orange Hound canine
                colorStroke = "#fb923c";
                label = "HOUND (REGISTRO)";
                break;
              case "CLUMP":
                colorFill = `rgba(236, 72, 153, ${0.45 + pulse * 0.55})`; // pink Clump cluster
                colorStroke = "#f472b6";
                label = "CLUMP (ATENÇÃO)";
                break;
              case "SKIN_STEALER":
                colorFill = `rgba(234, 179, 8, ${0.45 + pulse * 0.55})`; // yellow mimic
                colorStroke = "#facc15";
                label = "MIMÉTICO (ALERTA)";
                break;
              case "WRETCH":
                colorFill = `rgba(185, 28, 28, ${0.50 + pulse * 0.50})`; // deep blood red
                colorStroke = "#ef4444";
                label = "WRETCH (PERIGO)";
                break;
              default:
                colorFill = `rgba(239, 68, 68, ${0.45 + pulse * 0.55})`;
                colorStroke = "#f87171";
                label = "ANOMALIA DETECTADA";
                break;
            }

            ctx.fillStyle = colorFill;
            ctx.strokeStyle = colorStroke;
            ctx.lineWidth = 1.5;

            ctx.beginPath();
            ctx.arc(rX, rY, 5.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            // Double expanding warning wave ring
            ctx.save();
            ctx.strokeStyle = colorStroke;
            ctx.globalAlpha = 1.0 - pulse;
            ctx.beginPath();
            ctx.arc(rX, rY, 5.5 + pulse * 12, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();

            // Hostile tracking label
            ctx.fillStyle = colorStroke;
            ctx.font = "bold 7px Courier New, monospace";
            ctx.textAlign = "center";
            ctx.fillText(label, rX, rY - 9);
          }
        });
      }

      ctx.restore(); // Restore world-space transform matrix rotation

      // 7. Place static player transmitter dot in precise dead center
      ctx.fillStyle = "#deb81d";
      ctx.strokeStyle = "#ebd255";
      ctx.lineWidth = 1.5;

      // Draw sharp self arrow heading indicator pointing to direction walking/facing
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(currentArrowAngle + Math.PI / 2);

      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(4.5, 5);
      ctx.lineTo(-4.5, 5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.restore();

      // Ping acoustic sonar ripple effect expanding outward
      const pingProgress = (Date.now() * 0.02) % 36;
      ctx.strokeStyle = `rgba(222, 184, 29, ${1.0 - pingProgress / 36})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx, cy, pingProgress, 0, Math.PI * 2);
      ctx.stroke();

      // 8. Draw out of bounds arrow pointer pointing to Exit breach zone if too far away
      if (hasExit) {
        const exitX = map.exitGridX * map.cellSize + map.cellSize / 2;
        const exitZ = map.exitGridZ * map.cellSize + map.cellSize / 2;
        const rx = exitX - px;
        const rz = exitZ - pz;
        const dist = Math.sqrt(rx * rx + rz * rz);

        if (dist >= maxRange) {
          const directionAngle = Math.atan2(rz, rx);
          const drawAngle = directionAngle; // Points directly to the exit on static map

          const compassEdgeR = cx - 15;
          const arrowX = cx + Math.cos(drawAngle) * compassEdgeR;
          const arrowY = cy + Math.sin(drawAngle) * compassEdgeR;

          // Blinking green beacon
          const pulse = Math.abs(Math.sin(Date.now() * 0.004));
          ctx.fillStyle = `rgba(74, 222, 128, ${0.3 + pulse * 0.7})`;
          ctx.save();
          ctx.translate(arrowX, arrowY);
          ctx.rotate(drawAngle + Math.PI / 2); // rotate chevron to point outward/correctly

          // Render a clean chevron shape pointing towards escape exit breach
          ctx.beginPath();
          ctx.moveTo(0, -4);
          ctx.lineTo(3.5, 3);
          ctx.lineTo(-3.5, 3);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }

      // 9. Periodic radial radar sweep beam
      const sweepAngle = (Date.now() * 0.0018) % (Math.PI * 2);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(sweepAngle);

      const sweepGradient = ctx.createRadialGradient(0, 0, 0, 0, 0, cx - 12);
      sweepGradient.addColorStop(0, "rgba(222, 184, 29, 0.0)");
      sweepGradient.addColorStop(1, "rgba(222, 184, 29, 0.05)");

      ctx.fillStyle = sweepGradient;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, cx - 12, -0.25, 0, false);
      ctx.closePath();
      ctx.fill();

      // Trace line
      ctx.strokeStyle = "rgba(222, 184, 29, 0.22)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(cx - 12, 0);
      ctx.stroke();

      ctx.restore();

      // 10. Compasses indicators (N, S, E, W) printed relative to player rotation
      const labelRadius = cx - 21;
      const compassDirs = [
        { char: "N", radAngle: -Math.PI / 2 },
        { char: "E", radAngle: 0 },
        { char: "S", radAngle: Math.PI / 2 },
        { char: "W", radAngle: Math.PI }
      ];

      ctx.font = "bold 8px Courier New, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      compassDirs.forEach((dir) => {
        const lx = cx + Math.cos(dir.radAngle) * labelRadius;
        const ly = cy + Math.sin(dir.radAngle) * labelRadius;
        ctx.fillStyle = "#deb81d";
        ctx.fillText(dir.char, lx, ly);
      });

      // 11. Heavy CRT monitor aesthetic scanline effects
      ctx.strokeStyle = "rgba(222, 184, 29, 0.05)";
      ctx.lineWidth = 1;
      for (let y = 0; y < height; y += 4) {
        ctx.beginPath();
        ctx.moveTo(12, y);
        ctx.lineTo(width - 12, y);
        ctx.stroke();
      }

      // Outer gold glowing border frame
      ctx.strokeStyle = "#deb81d";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, cx - 12, 0, Math.PI * 2);
      ctx.stroke();
    };

    frameId = requestAnimationFrame(render);
    return () => {
      running = false;
      cancelAnimationFrame(frameId);
    };
  }, [engineRef, playersRef, level]);

  return (
    <div 
      className="bg-[#0b0a05]/92 border border-[#a28e3b]/30 w-full rounded p-3 flex flex-col gap-2.5 shadow-lg select-text pointer-events-auto text-[#deb81d] font-mono select-none"
      id="radar-hud-widget"
    >
      <div className="flex items-center justify-between border-b border-[#a28e3b]/20 pb-1.5">
        <div className="flex items-center gap-1.5">
          <Radio className="w-4 h-4 text-[#deb81d] animate-pulse" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-[#deb81d]">
            Radar Telemetria
          </span>
        </div>
        <span className={`text-[8px] font-bold px-2 py-0.5 rounded border transition-colors uppercase tracking-wider ${
          level === 2
            ? "text-red-500 bg-red-600/10 border-red-600/20 animate-pulse"
            : (level === 0 
                ? "text-yellow-400 bg-yellow-500/10 border-yellow-500/20 animate-pulse" 
                : "text-amber-500 bg-amber-600/10 border-amber-600/20")
        }`}>
          {level === 2 ? "NÍVEL 2: PIPE DREAMS" : (level === 1 ? "NÍVEL 1: ARMAZÉM" : "NÍVEL 0: O SAGUÃO")}
        </span>
      </div>

      {/* Embedded 2D Radar Canvas Frame */}
      <div className="relative flex justify-center bg-black/45 rounded py-2 border border-[#a28e3b]/10">
        <canvas 
          ref={canvasRef}
          width={156}
          height={156}
          className="rounded-full shadow-inner shadow-[#deb81d]/5"
        />
        {/* Subtle glass radial sheen overlay */}
        <div className="absolute inset-x-0 inset-y-2 rounded-full pointer-events-none bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.06)_0%,rgba(0,0,0,0)_60%)]" />
      </div>

      {/* Technical telemetry diagnostics panel */}
      <div className="text-[9px] bg-[#12110a] px-2.5 py-2 border border-[#a28e3b]/15 rounded divide-y divide-[#a28e3b]/10 flex flex-col gap-1 text-[#a28e3b]/85">
        <div className="flex justify-between pb-1 font-semibold uppercase">
          <span>COORDENADAS EXP:</span>
          <span className="text-[#deb81d]">
            X: {coords.x.toFixed(1)} / Z: {coords.z.toFixed(1)}
          </span>
        </div>
        <div className="flex justify-between py-1 font-semibold uppercase">
          <span>BÚSSOLA HEADING:</span>
          <span className="text-[#deb81d] flex items-center gap-1">
            <Compass className="w-3 h-3 text-[#deb81d]/60 inline" /> {headingDegrees}° {headingDegrees >= 337.5 || headingDegrees < 22.5 ? "N" : headingDegrees >= 22.5 && headingDegrees < 67.5 ? "NE" : headingDegrees >= 67.5 && headingDegrees < 112.5 ? "E" : headingDegrees >= 112.5 && headingDegrees < 157.5 ? "SE" : headingDegrees >= 157.5 && headingDegrees < 202.5 ? "S" : headingDegrees >= 202.5 && headingDegrees < 247.5 ? "SW" : headingDegrees >= 247.5 && headingDegrees < 292.5 ? "W" : "NW"}
          </span>
        </div>
        <div className="flex justify-between pt-1 font-semibold uppercase items-center">
          <span>SINAL RECEPTOR:</span>
          <span className={`text-[8px] font-bold whitespace-nowrap tracking-wider text-right uppercase ${vhsSignal.startsWith("CRÍTICO") ? "text-red-500 animate-pulse" : "text-[#deb81d]"}`}>
            {vhsSignal}
          </span>
        </div>
      </div>
    </div>
  );
};


export const RadarHUD = React.memo(RadarHUDComponent);
