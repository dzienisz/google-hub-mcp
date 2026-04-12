const TOTAL_DAYS = 25;
const TOTAL_POINTS = 25;
const TOTAL_SECRETS = 30;

export interface AiDevsStats {
  points: number;
  secrets: number;
  days: string[];
  mysteries: string[];
  email: string;
}

export async function fetchAiDevsStats(apiKey: string): Promise<AiDevsStats> {
  const res = await fetch("https://hub.ag3nts.org/stats", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ key: apiKey }),
  });
  if (!res.ok) throw new Error(`Stats API error: ${res.status}`);
  const data = await res.json() as AiDevsStats;
  return data;
}

export function buildDashboardHtml(stats: AiDevsStats): string {
  const completedDays = new Set(stats.days.map(Number));
  const pointsPct = Math.round((stats.points / TOTAL_POINTS) * 100);
  const secretsPct = Math.round((stats.secrets / TOTAL_SECRETS) * 100);
  const missionPct = Math.round((completedDays.size / TOTAL_DAYS) * 100);
  const now = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  const gridCells = Array.from({ length: TOTAL_DAYS }, (_, i) => {
    const day = i + 1;
    const done = completedDays.has(day);
    return `<div class="cell ${done ? "done" : "pending"}">
      <span class="day-num">${day}</span>
      ${done ? '<span class="check">✔</span>' : ""}
    </div>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Lexend+Deca:wght@400;600;700&family=DM+Mono:wght@400;500&display=swap');

  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 1024px; height: 600px; overflow: hidden;
    background: #0a0a0a;
    background-image: radial-gradient(rgba(255,255,255,0.025) 1px, transparent 1px);
    background-size: 24px 24px;
    color: #fff;
    font-family: 'Lexend Deca', system-ui, sans-serif;
    display: flex; flex-direction: column;
  }

  /* ── Header ── */
  header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 28px;
    background: #111;
    border-bottom: 1.5px solid #2a2a2a;
    flex-shrink: 0;
  }
  .logo-area { display: flex; align-items: center; gap: 10px; }
  .logo-dot {
    width: 10px; height: 10px; border-radius: 50%;
    background: #75f86f;
    box-shadow: 0 0 8px rgba(117,248,111,0.7);
  }
  .logo-text { font-size: 13px; font-weight: 700; color: #75f86f; letter-spacing: 0.08em; text-transform: uppercase; }
  .header-stats { display: flex; gap: 28px; align-items: center; }
  .stat { text-align: center; }
  .stat-val {
    font-family: 'DM Mono', monospace;
    font-size: 22px; font-weight: 500; color: #fff; line-height: 1;
  }
  .stat-val span { color: #444; font-size: 16px; }
  .stat-label { font-size: 10px; color: #555; text-transform: uppercase; letter-spacing: 0.1em; margin-top: 3px; }
  .stat-sep { width: 1px; height: 32px; background: #2a2a2a; }
  .clock { font-family: 'DM Mono', monospace; font-size: 12px; color: #444; }

  /* ── Body ── */
  .body { flex: 1; display: grid; grid-template-columns: 1fr 340px; gap: 0; overflow: hidden; }

  /* ── Mission grid ── */
  .grid-section { padding: 20px 24px; display: flex; flex-direction: column; gap: 12px; border-right: 1px solid #1a1a1a; }
  .section-label { font-size: 10px; font-weight: 600; color: #444; text-transform: uppercase; letter-spacing: 0.1em; }
  .mission-grid {
    display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px;
    flex: 1;
  }
  .cell {
    border-radius: 6px; border: 1px solid #222;
    display: flex; align-items: center; justify-content: center;
    position: relative; aspect-ratio: 1;
    transition: all 0.2s;
  }
  .cell.done {
    background: linear-gradient(135deg, rgba(117,248,111,0.15), rgba(117,248,111,0.05));
    border-color: rgba(117,248,111,0.35);
    box-shadow: 0 0 8px rgba(117,248,111,0.08);
  }
  .cell.pending { background: #111; border-color: #1e1e1e; }
  .day-num { font-family: 'DM Mono', monospace; font-size: 12px; color: #333; position: absolute; top: 5px; left: 7px; }
  .cell.done .day-num { color: rgba(117,248,111,0.5); }
  .check { font-size: 18px; color: #75f86f; }

  /* ── Stats panel ── */
  .stats-section { padding: 20px 24px; display: flex; flex-direction: column; gap: 18px; }

  .progress-block { display: flex; flex-direction: column; gap: 7px; }
  .progress-header { display: flex; justify-content: space-between; align-items: baseline; }
  .progress-title { font-size: 11px; font-weight: 600; color: #555; text-transform: uppercase; letter-spacing: 0.08em; }
  .progress-value { font-family: 'DM Mono', monospace; font-size: 13px; color: #aaa; }
  .progress-track {
    height: 6px; background: #1a1a1a; border-radius: 3px; overflow: hidden;
  }
  .progress-fill {
    height: 100%; border-radius: 3px;
    background: linear-gradient(90deg, #75f86f, #4ad645);
    box-shadow: 0 0 6px rgba(117,248,111,0.4);
  }
  .progress-fill.secrets { background: linear-gradient(90deg, #f8c46f, #e5a830); box-shadow: 0 0 6px rgba(248,196,111,0.4); }
  .progress-fill.mission { background: linear-gradient(90deg, #6fb8f8, #3a90e5); box-shadow: 0 0 6px rgba(111,184,248,0.4); }

  .divider { height: 1px; background: #1a1a1a; }

  .recent-block { flex: 1; }
  .recent-title { font-size: 10px; font-weight: 600; color: #444; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 10px; }
  .recent-grid { display: flex; flex-wrap: wrap; gap: 5px; }
  .recent-badge {
    font-family: 'DM Mono', monospace; font-size: 11px;
    padding: 3px 8px; border-radius: 4px;
    background: rgba(117,248,111,0.08);
    border: 1px solid rgba(117,248,111,0.2);
    color: #75f86f;
  }

  .footer-note {
    font-size: 10px; color: #333;
    font-family: 'DM Mono', monospace;
    margin-top: auto;
  }
</style>
</head>
<body>
  <header>
    <div class="logo-area">
      <div class="logo-dot"></div>
      <div class="logo-text">AI Devs 4 · Centrala</div>
    </div>
    <div class="header-stats">
      <div class="stat">
        <div class="stat-val">${stats.points}<span>/${TOTAL_POINTS}</span></div>
        <div class="stat-label">Points</div>
      </div>
      <div class="stat-sep"></div>
      <div class="stat">
        <div class="stat-val">${stats.secrets}<span>/${TOTAL_SECRETS}</span></div>
        <div class="stat-label">Secrets</div>
      </div>
      <div class="stat-sep"></div>
      <div class="stat">
        <div class="stat-val">${completedDays.size}<span>/${TOTAL_DAYS}</span></div>
        <div class="stat-label">Days</div>
      </div>
      <div class="stat-sep"></div>
      <div class="clock">${now}</div>
    </div>
  </header>

  <div class="body">
    <div class="grid-section">
      <div class="section-label">Mission Map</div>
      <div class="mission-grid">${gridCells}</div>
    </div>

    <div class="stats-section">
      <div class="progress-block">
        <div class="progress-header">
          <span class="progress-title">Points</span>
          <span class="progress-value">${stats.points}/${TOTAL_POINTS} · ${pointsPct}%</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${pointsPct}%"></div></div>
      </div>

      <div class="progress-block">
        <div class="progress-header">
          <span class="progress-title">Secrets</span>
          <span class="progress-value">${stats.secrets}/${TOTAL_SECRETS} · ${secretsPct}%</span>
        </div>
        <div class="progress-track"><div class="progress-fill secrets" style="width:${secretsPct}%"></div></div>
      </div>

      <div class="progress-block">
        <div class="progress-header">
          <span class="progress-title">Mission</span>
          <span class="progress-value">${completedDays.size}/${TOTAL_DAYS} · ${missionPct}%</span>
        </div>
        <div class="progress-track"><div class="progress-fill mission" style="width:${missionPct}%"></div></div>
      </div>

      <div class="divider"></div>

      <div class="recent-block">
        <div class="recent-title">Completed Days</div>
        <div class="recent-grid">
          ${Array.from(completedDays).sort((a, b) => a - b).map(d => `<span class="recent-badge">Day ${d}</span>`).join("")}
        </div>
      </div>

      <div class="footer-note">hub.ag3nts.org · ${stats.email.split("@")[0]}</div>
    </div>
  </div>
</body>
</html>`;
}
