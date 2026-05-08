/* Monitoring Module Logic */

let metricsTimer = null;

function startMetrics() {
    fetchMetrics();
    if (!metricsTimer) metricsTimer = setInterval(fetchMetrics, 1000);
}

function stopMetrics() {
    clearInterval(metricsTimer);
    metricsTimer = null;
}

async function fetchMetrics() {
    try {
        const res = await fetch('/api/metrics?token=' + TOKEN);
        const data = await res.json();
        if (!data.ok) return;

        // Textos del Monitor
        const cpuEl = document.getElementById('m-cpu');
        const ramEl = document.getElementById('m-ram');
        const tempEl = document.getElementById('m-temp');

        if (cpuEl) cpuEl.textContent = data.cpu + '%';
        if (ramEl) ramEl.textContent = data.ram + '%';
        if (tempEl) tempEl.textContent = data.temp + '°C';

        // Barras
        const barCpu = document.getElementById('bar-cpu');
        const barRam = document.getElementById('bar-ram');
        const barTemp = document.getElementById('bar-temp');

        if (barCpu) barCpu.style.width = Math.min(data.cpu, 100) + '%';
        if (barRam) barRam.style.width = Math.min(data.ram, 100) + '%';
        if (barTemp) barTemp.style.width = Math.min(data.temp, 100) + '%';

        // Cards del Menú
        const scCpu = document.getElementById('sc-cpu');
        const scRam = document.getElementById('sc-ram');
        const scTemp = document.getElementById('sc-temp');

        if (scCpu) scCpu.textContent = data.cpu + '%';
        if (scRam) scRam.textContent = data.ram + '%';
        if (scTemp) scTemp.textContent = data.temp + '°C';

        if (data.power) {
            const powerTag = document.getElementById('power-tag');
            if (powerTag) powerTag.innerHTML = '⚡ ' + data.power;
        }

        if (data.hist) {
            drawSpark('spark-cpu', data.hist.cpu, '#f87171');
            drawSpark('spark-ram', data.hist.ram, '#c084fc');
            drawSpark('spark-temp', data.hist.temp, '#fb923c');
        }
    } catch (e) { }
}

function drawSpark(id, data, color) {
    const c = document.getElementById(id);
    if (!c || !data || data.length < 2) return;
    const W = c.offsetWidth, H = c.offsetHeight;
    if (W === 0 || H === 0) return;
    
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    const min = Math.min(...data);
    const max = Math.max(...data);
    const rng = (max - min) || 1;
    const pad = H * 0.15;
    const pts = data.map((v, i) => ({
        x: (i / (data.length - 1)) * W,
        y: H - pad - ((v - min) / rng) * (H - pad * 2)
    }));

    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, color + '40');
    grad.addColorStop(1, color + '00');
    ctx.beginPath();
    ctx.moveTo(pts[0].x, H);
    pts.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(pts[pts.length - 1].x, H);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    const lp = pts[pts.length - 1];
    ctx.beginPath();
    ctx.arc(lp.x, lp.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
}
