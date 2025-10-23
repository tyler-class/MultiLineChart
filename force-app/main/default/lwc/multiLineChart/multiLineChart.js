import { LightningElement, api } from 'lwc';
import { loadScript } from 'lightning/platformResourceLoader';
import { NavigationMixin } from 'lightning/navigation';
import CHARTJS from '@salesforce/resourceUrl/chartjs';
import getSeries from '@salesforce/apex/MultiLineChartController.getSeries';

// High-contrast palette (up to 6)
const SERIES_COLORS = [
    '#3366CC', '#DC3912', '#FF9900', '#109618', '#990099', '#0099C6'
];

// Return color + dash style for series index i
function seriesStyle(i) {
    const base = SERIES_COLORS[i % SERIES_COLORS.length];
    const cycle = Math.floor(i / SERIES_COLORS.length);
    return {
        borderColor: base,
        backgroundColor: base + '33',
        borderDash: cycle > 0 ? [6, 4] : undefined
    };
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

    renderedCallback() {
        if (this.chartLoaded) return;
        this.chartLoaded = true;

        console.log('Chart config:', {
            recordId: this.recordId,
            fieldsCsv: this.fieldsCsv,
            childObjectApiName: this.childObjectApiName,
            dateFieldApiName: this.dateFieldApiName,
            parentLookupPath: this.parentLookupPath,
            dateFilter: this.dateFilter,
            maxPoints: this.maxPoints
        });

        loadScript(this, CHARTJS)
            .then(() => this.draw())
            .catch(e => this.handleError(e));
    }

    disconnectedCallback() {
        if (this.chart) this.chart.destroy();
    }

    async draw() {
        try {
            const required = [
                this.recordId,
                this.fieldsCsv,
                this.childObjectApiName,
                this.dateFieldApiName,
                this.parentLookupPath
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
            const fieldLabels = res.fieldLabels || {};

            const canvas = this.template.querySelector('canvas');
            const ctx = canvas.getContext('2d');
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
                    borderWidth: 2,
                    borderColor: style.borderColor,
                    backgroundColor: style.backgroundColor,
                    borderDash: style.borderDash,
                    pointRadius: 3,
                    pointHoverRadius: 5
                };
            });

            this.chart = new window.Chart(ctx, {
                type: 'line',
                data: { labels, datasets: styledDatasets },
                options: {
                    responsive: false,
                    maintainAspectRatio: false,
                    parsing: true,
                    onClick: (event, activeEls) => {
                        if (!activeEls?.length) return;
                        const { index } = activeEls[0];
                        const recId = this.rows[index]?.Id;
                        if (recId) {
                            this[NavigationMixin.Navigate]({
                                type: 'standard__recordPage',
                                attributes: {
                                    recordId: recId,
                                    actionName: 'view'
                                }
                            });
                        }
                    },
                    scales: {
                        x: {
                            type: 'category',
                            ticks: {
                                callback: function (value) {
                                    const raw = (typeof this.getLabelForValue === 'function')
                                        ? this.getLabelForValue(value)
                                        : value;
                                    const d = new Date(raw);
                                    if (Number.isNaN(d.getTime())) return raw;
                                    const mm = String(d.getMonth() + 1).padStart(2, '0');
                                    const dd = String(d.getDate()).padStart(2, '0');
                                    const yyyy = d.getFullYear();
                                    return `${mm}/${dd}/${yyyy}`;
                                },
                                maxRotation: 0,
                                autoSkip: true
                            }
                        },
                        y: { beginAtZero: true }
                    },
                    plugins: {
                        legend: { position: 'bottom' },
                        tooltip: { mode: 'nearest', intersect: false }
                    }
                }
            });
        } catch (e) {
            this.handleError(e);
        }
    }

    handleError(e) {
        this.error = e?.body?.message || e?.message || String(e);
        console.error('Chart error:', e);
    }
}