let chartSys = null;
let chartNet = null;
let chartTempBig = null;
let chartDisk = null;

let metricsTimer = null;
let prevValues = {};

let colors = {};

function initColors() {
    const style = getComputedStyle(document.getElementById('view-monitor') || document.documentElement);
    colors = {
        cpu: style.getPropertyValue('--cpu').trim() || '#f87171',
        ram: style.getPropertyValue('--ram').trim() || '#c084fc',
        temp: style.getPropertyValue('--temp').trim() || '#fb923c',
        disk: style.getPropertyValue('--disk').trim() || '#34d399',
        latency: style.getPropertyValue('--latency').trim() || '#60a5fa',
        rps: style.getPropertyValue('--rps').trim() || '#f472b6',
        grid: 'rgba(148, 163, 184, 0.1)',
        diskBg: document.documentElement.getAttribute('data-theme') === 'dark' ? '#374151' : '#e2e8f0'
    };
}

export function startMetrics() {
    initColors();
    initCharts();
    fetchMetrics();
    if (!metricsTimer) metricsTimer = setInterval(fetchMetrics, 1000);

    window.addEventListener('resize', () => {
        fetchMetrics();
    });
}

export function stopMetrics() {
    if (metricsTimer) {
        clearInterval(metricsTimer);
        metricsTimer = null;
    }
}

function initCharts() {
    if (typeof Chart === 'undefined') return;

    const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        scales: {
            x: { display: false },
            y: { grid: { color: colors.grid }, ticks: { color: '#94a3b8', font: { size: 10 } } }
        },
        plugins: { legend: { display: true, labels: { color: '#94a3b8', boxWidth: 12, font: { size: 11 } } } }
    };

    const isEn = window.currentLang === 'en';
    const ctxSys = document.getElementById('chart-sys');
    if (ctxSys && !chartSys) {
        chartSys = new Chart(ctxSys.getContext('2d'), {
            type: 'line',
            data: {
                labels: [], datasets: [
                    { label: 'CPU (%)', data: [], borderColor: colors.cpu, backgroundColor: 'transparent', tension: 0.3, borderWidth: 2, pointRadius: 0 },
                    { label: 'RAM (%)', data: [], borderColor: colors.ram, backgroundColor: 'transparent', tension: 0.3, borderWidth: 2, pointRadius: 0 }
                ]
            },
            options: {
                ...chartOptions,
                scales: {
                    x: { display: false },
                    y: { min: 0, max: 100, grid: { color: colors.grid }, ticks: { color: '#94a3b8', font: { size: 10 }, stepSize: 20 } }
                }
            }
        });
    }

    const ctxNet = document.getElementById('chart-net');
    if (ctxNet && !chartNet) {
        chartNet = new Chart(ctxNet.getContext('2d'), {
            type: 'line',
            data: {
                labels: [], datasets: [
                    { label: isEn ? 'Latency (ms)' : 'Latencia (ms)', data: [], borderColor: colors.latency, backgroundColor: 'transparent', tension: 0.2, borderWidth: 2, pointRadius: 0, yAxisID: 'y' },
                    { label: 'RPS (Req/s)', data: [], borderColor: colors.rps, backgroundColor: 'transparent', tension: 0.2, borderWidth: 2, pointRadius: 0, yAxisID: 'y1' }
                ]
            },
            options: {
                ...chartOptions,
                scales: {
                    x: { display: false },
                    y: { type: 'linear', display: true, position: 'left', grid: { color: colors.grid }, ticks: { color: colors.latency } },
                    y1: { type: 'linear', display: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { color: colors.rps } }
                }
            }
        });
    }

    const ctxTemp = document.getElementById('chart-temp-big');
    if (ctxTemp && !chartTempBig) {
        chartTempBig = new Chart(ctxTemp.getContext('2d'), {
            type: 'line',
            data: {
                labels: [], datasets: [
                    { label: isEn ? 'Temperature (°C)' : 'Temperatura (°C)', data: [], borderColor: colors.temp, backgroundColor: 'rgba(251, 146, 60, 0.1)', fill: true, tension: 0.3, borderWidth: 2, pointRadius: 0 }
                ]
            },
            options: chartOptions
        });
    }

    const ctxDisk = document.getElementById('chart-disk');
    if (ctxDisk && !chartDisk) {
        chartDisk = new Chart(ctxDisk.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: [], datasets: [
                    { data: [], backgroundColor: [colors.disk, colors.diskBg, '#94a3b8'], borderWidth: 0 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom', labels: { color: '#64748b' } } }
            }
        });
    }
}

function drawSparkline(canvasId, data, color) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!data || data.length < 2) return;

    const max = Math.max(...data) * 1.1 || 100;
    const min = Math.min(...data) * 0.9 || 0;
    const range = max - min;

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';

    for (let i = 0; i < data.length; i++) {
        const x = (i / (data.length - 1)) * canvas.width;
        const y = canvas.height - ((data[i] - min) / (range || 1)) * canvas.height;

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();
}

async function fetchMetrics() {
    try {
        const res = await fetch('/api/metrics/live?token=' + window.TOKEN);
        if (res.status === 401) {
            stopMetrics();
            location.href = '/';
            return;
        }

        const data = await res.json();
        if (!data.ok) return;

        // Top bar updates
        const updateTime = document.getElementById('update-time');
        if (updateTime) updateTime.innerText = new Date().toLocaleTimeString();

        if (data.power) {
            let pStr = data.power;
            if (window.currentLang === 'en') {
                pStr = pStr.replace('Red', 'AC Power')
                    .replace('Bat', 'Battery')
                    .replace('Límite CPU:', 'CPU Limit:')
                    .replace('Servidor conectado', 'Server connected');
            }
            const powerTag = document.getElementById('power-tag');
            if (powerTag) {
                powerTag.innerHTML = pStr;
                powerTag.style.borderColor = colors.disk;
                powerTag.style.color = colors.disk;
            }
        }

        const netInfo = document.getElementById('net-info');
        if (netInfo && data.network) {
            netInfo.removeAttribute('data-i18n');
            const sentMb = (data.network.bytes_sent / (1024 ** 2)).toFixed(1);
            const recvMb = (data.network.bytes_recv / (1024 ** 2)).toFixed(1);
            const totalGb = ((data.network.bytes_sent + data.network.bytes_recv) / (1024 ** 3)).toFixed(2);
            const totalLabel = window.currentLang === 'en' ? 'Total' : 'Total';
            netInfo.innerHTML = `
                <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:0.72rem;">
                    <span style="color:var(--text-muted);">⬆ <span style="color:var(--text-main);font-weight:600;">${sentMb} MB</span></span>
                    <span style="color:var(--text-muted);">⬇ <span style="color:var(--text-main);font-weight:600;">${recvMb} MB</span></span>
                    <span style="color:var(--text-muted);">${totalLabel} <span style="color:var(--text-main);font-weight:600;">${totalGb} GB</span></span>
                </div>
            `;
        }

        // Metrics loop
        const metrics = ['cpu', 'ram', 'temp', 'latency', 'rps'];
        metrics.forEach(key => {
            const newVal = data[key];
            if (newVal === undefined) return;

            const elValue = document.getElementById(`m-${key}`);
            const elBar = document.getElementById(`bar-${key}`);

            if (elValue) {
                const isFloat = key === 'ram' || key === 'latency';
                const formattedVal = isFloat ? newVal.toFixed(1) : Math.round(newVal);
                elValue.innerText = `${formattedVal}${elValue.dataset.suffix || ''}`;
            }
            if (elBar) {
                let pct = newVal;
                if (key === 'rps') pct = Math.min((newVal / 400) * 100, 100);
                if (key === 'latency') pct = Math.min((newVal / 200) * 100, 100);
                elBar.style.width = `${pct}%`;
            }

            if (data.hist && data.hist[key]) {
                drawSparkline(`spark-${key}`, data.hist[key], colors[key]);

                const trendEl = document.getElementById(`trend-${key}`);
                const historyArr = data.hist[key];
                if (trendEl && historyArr.length >= 2) {
                    const last = historyArr[historyArr.length - 1];
                    const prev = historyArr[historyArr.length - 2];
                    const delta = prev === 0 ? 0 : ((last - prev) / prev) * 100;

                    let color = "";
                    let icon = "";

                    if (last > prev) {
                        icon = "↑";
                        color = (key === 'rps') ? "#10b981" : "#ef4444";
                    } else if (last < prev) {
                        icon = "↓";
                        color = (key === 'rps') ? "#ef4444" : "#10b981";
                    }

                    if (last === prev) {
                        trendEl.style.color = "#9ca3af";
                        trendEl.innerHTML = "—";
                    } else {
                        trendEl.style.color = color;
                        trendEl.innerHTML = `${icon} ${Math.abs(delta).toFixed(1)}%`;
                    }
                }
            }
        });

        // Disk
        if (data.disk && Array.isArray(data.disk)) {
            const diskList = document.getElementById('disk-list');
            if (diskList) {
                diskList.innerHTML = data.disk.map(d => {
                    const pct = Math.round((d.used / d.total) * 100);
                    const usedGB = (d.used / (1024 ** 3)).toFixed(1);
                    const totalGB = (d.total / (1024 ** 3)).toFixed(1);
                    let devName = d.device;
                    if (window.currentLang === 'en') {
                        devName = devName.replace('Sistema (OS)', 'System (OS)').replace('Almacén (Data)', 'Storage (Data)');
                    }
                    return `
                        <div class="tw-disk-item">
                            <span>${d.mountpoint} (${devName})</span>
                            <span style="font-weight:700">${pct}% (${usedGB} GB / ${totalGB} GB)</span>
                        </div>
                    `;
                }).join('');
            }

            if (chartDisk) {
                // For a single disk or aggregated, we just show the first disk's used vs free as doughnut
                const firstDisk = data.disk[0];
                if (firstDisk) {
                    const used = parseFloat((firstDisk.used / (1024 ** 3)).toFixed(1));
                    const free = parseFloat(((firstDisk.total - firstDisk.used) / (1024 ** 3)).toFixed(1));
                    chartDisk.data.labels = window.currentLang === 'en' ? ['Used (GB)', 'Free (GB)'] : ['Usado (GB)', 'Libre (GB)'];
                    chartDisk.data.datasets[0].data = [used, free];
                    chartDisk.update('none');
                }
            }
        }

        // Charts update
        if (data.hist) {
            const len = data.hist.cpu ? data.hist.cpu.length : 20;
            const labels = Array(len).fill('');

            if (chartSys) {
                chartSys.data.labels = labels;
                chartSys.data.datasets[0].data = data.hist.cpu || [];
                chartSys.data.datasets[1].data = data.hist.ram || [];
                chartSys.update('none');
            }
            if (chartNet) {
                chartNet.data.labels = labels;
                chartNet.data.datasets[0].data = data.hist.latency || [];
                chartNet.data.datasets[1].data = data.hist.rps || [];
                chartNet.update('none');
            }
            if (chartTempBig) {
                chartTempBig.data.labels = labels;
                chartTempBig.data.datasets[0].data = data.hist.temp || [];
                chartTempBig.update('none');
            }
        }

    } catch (error) {
        console.error('Error fetching metrics:', error);
        const powerTag = document.getElementById('power-tag');
        if (powerTag) {
            powerTag.removeAttribute('data-i18n');
            powerTag.innerHTML = window.currentLang === 'en' ? '⚠ Connection error' : '⚠ Error de conexión';
            powerTag.style.borderColor = colors.cpu;
            powerTag.style.color = colors.cpu;
        }
    }
}
