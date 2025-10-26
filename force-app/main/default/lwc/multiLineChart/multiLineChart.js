import { LightningElement, api } from 'lwc';
import { loadScript } from 'lightning/platformResourceLoader';
import { NavigationMixin } from 'lightning/navigation';
import CHARTJS from '@salesforce/resourceUrl/chartjs';
import getSeries from '@salesforce/apex/MultiLineChartController.getSeries';

const SERIES_COLORS = [
    '#1F77B4', // strong blue 
    '#D62728', // bold red 
    '#FF7F0E', // orange 
    '#2CA02C', // medium green 
    '#9467BD', // purple 
    '#17BECF', // bright cyan / turquoise
    '#E377C2', // soft pink / magenta
    '#8C564B', // brownish red 
    '#BCBD22', // yellow-green / chartreuse 
    '#7F7F7F'  // neutral gray-blue 
  ];

function seriesStyle(i) {
  const base = SERIES_COLORS[i % SERIES_COLORS.length];
  const cycle = Math.floor(i / SERIES_COLORS.length);
  const dashPatterns = [undefined, [6,4], [2,4], [10,6], [6,4,2,4]];
  const pointStyles = ['circle', 'rect', 'triangle', 'cross', 'star'];
  return {
    borderColor: base,
    backgroundColor: base + '33',
    borderDash: dashPatterns[cycle % dashPatterns.length],
    borderWidth: 2 + (cycle % 2),
    pointStyle: pointStyles[cycle % pointStyles.length],
    pointRadius: 5 + (cycle % 2)
  };
}

// Fallback: convert API name to a nicer label
function apiToLabel(api) {
  if (!api) return '';
  return api.replace(/__c$/,'').replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase());
}

export default class MultiLineChart extends NavigationMixin(LightningElement) {
  @api title = 'Multi-Line Chart';
  @api fieldsCsv;
  @api childObjectApiName;
  @api dateFieldApiName;
  @api parentLookupPath;
  @api dateFilter;
  @api maxPoints = 200;
  @api recordId;

  chart;
  chartLoaded = false;
  error;
  rows = [];
  objectLabel = '';
  _tooltipPinned = false;
  _hideTimer = null;

  // ---------- formatting ----------
  formatDateLabel(raw) {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    const yyyy = d.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  }
  formatDateTimeLabel(raw) {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    const yyyy = d.getFullYear();
    let hh = d.getHours(); const ampm = hh >= 12 ? 'PM' : 'AM';
    hh = hh % 12 || 12;
    const min = String(d.getMinutes()).padStart(2,'0');
    return `${mm}/${dd}/${yyyy} ${hh}:${min} ${ampm}`;
  }

  // ---------- handle show/hide all toggle in the UI
  handleHideAll() {
    if (!this.chart) return;
    this.chart.data.datasets.forEach((_, i) => {
      this.chart.setDatasetVisibility(i, false);
    });
    this.chart.update();
  }
  
  handleShowAll() {
    if (!this.chart) return;
    this.chart.data.datasets.forEach((_, i) => {
      this.chart.setDatasetVisibility(i, true);
    });
    this.chart.update();
  }

  // ---------- external (HTML) tooltip showing ALL series at the index ----------
  externalTooltipHandler(context) {
    const { chart, tooltip } = context;
  
    let el = this.template.querySelector('.chartjs-ext-tooltip');
    if (!el) {
      el = document.createElement('div');
      el.className = 'chartjs-ext-tooltip';
      Object.assign(el.style, {
        position: 'absolute',
        pointerEvents: 'auto',
        background: 'rgba(0,0,0,0.85)',
        color: '#fff',
        padding: '8px 10px',
        borderRadius: '4px',
        fontSize: '12px',
        maxWidth: '320px',
        zIndex: '9999',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
      });
      const container = this.template.querySelector('.chart')?.parentElement;
      (container || this.template.host).appendChild(el);
  
      // sticky behavior
      el.addEventListener('mouseenter', () => {
        this._tooltipPinned = true;
        if (this._hideTimer) { clearTimeout(this._hideTimer); this._hideTimer = null; }
      });
      el.addEventListener('mouseleave', () => {
        this._tooltipPinned = false;
        el.style.display = 'none';
        el.style.opacity = '0';
      });
    }
  
    // Hide with brief delay to allow entering tooltip
    if (tooltip.opacity === 0) {
      if (this._tooltipPinned) return;
      if (this._hideTimer) clearTimeout(this._hideTimer);
      this._hideTimer = setTimeout(() => {
        if (!this._tooltipPinned) {
          el.style.opacity = '0';
          el.style.display = 'none';
        }
        this._hideTimer = null;
      }, 150);
      return;
    }
  
    // We use nearest mode, so this will be the single hovered point
    const dp = (tooltip.dataPoints && tooltip.dataPoints[0]) || null;
    if (!dp) return;
  
    const idx = dp.dataIndex;                    // x index (row index)
    const targetY = Number(dp.parsed.y);         // hovered y value
    const EPS = 1e-9;                            // float tolerance
  
    // Find all other datasets that share exactly the same x index AND y value
    const datasets = chart.data.datasets || [];
    const samePoints = [];
    for (let di = 0; di < datasets.length; di++) {
      const ds = datasets[di];
      const rawVal = ds.data?.[idx];
      const yVal = typeof rawVal === 'object' && rawVal !== null ? Number(rawVal.y) : Number(rawVal);
      if (Number.isNaN(yVal)) continue;
      if (Math.abs(yVal - targetY) < EPS) {
        samePoints.push({
          label: ds.label,
          color: ds.borderColor,
          value: dp.formatter ? dp.formatter(yVal) : yVal
        });
      }
    }
  
    // Common header (date) and record link (x index always maps to the same record in your data model)
    const row = this.rows?.[idx] || {};
    const recId = row.Id;
    const recName = row.Name || '(record)';
    const dateTitle = this.formatDateTimeLabel(row.x);
    const href = recId ? `${window.location.origin}/lightning/r/${recId}/view` : null;
    const niceObjectLabel = this.objectLabel || (this.childObjectApiName || '').replace(/__c$/,'').replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase());
  
    // Build content:
    let bodyHtml = '';
    if (samePoints.length <= 1) {
      // Single tooltip: just the hovered dataset line
      const color = dp.dataset.borderColor;
      const label = dp.dataset.label;
      const value = dp.formattedValue;
      bodyHtml = `
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="display:inline-block;width:10px;height:10px;background:${color};border-radius:2px;"></span>
          <div>${label}: <strong>${value}</strong></div>
        </div>
        ${href ? `<div style="margin-top:6px;"><a href="${href}" target="_blank" rel="noopener" style="color:#9bd; text-decoration:underline;">Open ${niceObjectLabel} “${recName}”</a></div>` : ''}
      `;
    } else {
      // Combined tooltip: list only those that share the same X & Y values
      bodyHtml = samePoints.map(sp => `
        <div style="margin-top:6px; display:flex; align-items:center; gap:8px;">
          <span style="display:inline-block;width:10px;height:10px;background:${sp.color};border-radius:2px;"></span>
          <div style="display:flex; flex-direction:column;">
            <div>${sp.label}: <strong>${sp.value}</strong></div>
            ${href ? `<a href="${href}" target="_blank" rel="noopener" style="color:#9bd; text-decoration:underline;">Open ${niceObjectLabel} “${recName}”</a>` : ''}
          </div>
        </div>
      `).join('');
    }
  
    el.innerHTML = `
      <div style="margin-bottom:4px; font-weight:600;">${dateTitle}</div>
      ${bodyHtml}
    `;
  
    // Position
    const { offsetLeft: left, offsetTop: top } = chart.canvas;
    el.style.display = 'block';
    el.style.opacity = '1';
    el.style.left = left + tooltip.caretX + 10 + 'px';
    el.style.top  = top  + tooltip.caretY + 10 + 'px';
  }

  // ---------- lifecycle ----------
  renderedCallback() {
    if (this.chartLoaded) return;
    this.chartLoaded = true;

    loadScript(this, CHARTJS)
      .then(() => this.draw())
      .catch(e => this.handleError(e));
  }
  disconnectedCallback() { if (this.chart) this.chart.destroy(); }

  // ---------- draw the graph ----------
  async draw() {
    try {
      const required = [
        this.recordId, this.fieldsCsv, this.childObjectApiName,
        this.dateFieldApiName, this.parentLookupPath
      ];
      if (required.some(v => !v)) {
        this.handleError('Please configure all required parameters.');
        return;
      }

      const metricFields = this.fieldsCsv.split(',').map(s => s.trim()).filter(Boolean);
      const limitVal = this.maxPoints ? parseInt(this.maxPoints, 10) : null;

      const res = await getSeries({
        parentId: this.recordId,
        childObjectApiName: this.childObjectApiName,
        dateFieldApiName: this.dateFieldApiName,
        parentLookupPath: this.parentLookupPath,
        metricFieldApiNames: metricFields,
        maxPoints: isNaN(limitVal) ? null : limitVal,
        dateFilter: this.dateFilter || null
      });

      this.rows = res.rows || [];
      this.objectLabel = res.objectLabel || '';
      const fieldLabels = res.fieldLabels || {};

      const canvas = this.template.querySelector('canvas.chart');
      const ctx = canvas.getContext('2d');
      canvas.style.cursor = 'pointer';
      if (this.chart) this.chart.destroy();

      const labels = this.rows.map(r => r.x);
      const styledDatasets = metricFields.map((apiName, i) => {
        const style = seriesStyle(i);
        const displayLabel = fieldLabels[apiName] || apiName;
        return {
          label: displayLabel,
          data: this.rows.map(r => r[apiName]),
          fill: false,
          tension: 0.2,
          borderWidth: style.borderWidth,
          borderColor: style.borderColor,
          backgroundColor: style.backgroundColor,
          borderDash: style.borderDash,
          pointStyle: style.pointStyle,
          pointRadius: style.pointRadius,
          pointHoverRadius: 5
        };
      });

      // Legend title text (dynamic)
      const objectLabelForLegend =
        this.objectLabel ||
        apiToLabel(this.childObjectApiName) ||
        'Object';

      const self = this;
      this.chart = new window.Chart(ctx, {
        type: 'line',
        data: { labels, datasets: styledDatasets },
        options: {
          responsive: false,
          maintainAspectRatio: false,
          parsing: true,

          // Show tooltip for the point under the cursor
          interaction: { mode: 'nearest', intersect: true },

          // Clicking a point opens the record (uses nearest point)
          onClick: (evt, _active, chart) => {
            const points = chart.getElementsAtEventForMode(evt, 'nearest', { intersect: true }, true);
            if (!points.length) return;
            const { index } = points[0];
            const recId = self.rows?.[index]?.Id;
            if (recId) window.open(`${window.location.origin}/lightning/r/${recId}/view`, '_blank');
          },

          scales: {
            x: {
              type: 'category',
              ticks: {
                callback: function (value) {
                  const raw = (typeof this.getLabelForValue === 'function') ? this.getLabelForValue(value) : value;
                  return self.formatDateLabel(raw);
                },
                maxRotation: 0,
                autoSkip: true
              }
            },
            y: { beginAtZero: true }
          },

          plugins: {
            legend: {
              position: 'left',
              labels: {
                usePointStyle: true, 
                boxWidth: 10,
                padding: 12
              },
              // 👇 Legend title (bold, centered)
              title: {
                display: true,
                text: `${objectLabelForLegend} Data`,
                color: '#000',
                font: { size: 14, weight: 'bold' },
                padding: { top: 8, bottom: 6 },
                align: 'center'
              }
            },
            tooltip: {
              enabled: false,
              external: (ctx) => this.externalTooltipHandler(ctx)
            }
          }
        }
      });
    } catch (e) {
      this.handleError(e);
    }
  }

  handleError(e) {
    this.error = e?.body?.message || e?.message || String(e);
    // eslint-disable-next-line no-console
    console.error('Chart error:', e);
  }
}
