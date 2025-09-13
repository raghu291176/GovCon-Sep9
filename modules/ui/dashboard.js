import { updateComplianceChart, updateViolationsChart, updateAmountChart } from "./charts.js";

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

export function updateDashboard(auditResults, glData, charts) {
  const data = Array.isArray(auditResults) && auditResults.length > 0 ? auditResults : (glData || []);

  const total = data.length;
  const red = data.filter((i) => i.status === "RED").length;
  const yellow = data.filter((i) => i.status === "YELLOW").length;
  const green = data.filter((i) => i.status === "GREEN").length;
  const violations = red + yellow;
  const amountTotal = (data || []).reduce((sum, x) => sum + (Number(x.amount) || 0), 0);
  const complianceRate = total > 0 ? Math.round((green / total) * 100) : 100;

  // Match IDs present in index.html
  setText("total-entries", total.toLocaleString());
  setText("violations-count", violations.toLocaleString());
  setText("compliance-rate", `${complianceRate}%`);
  setText("total-amount", `$${amountTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);

  // Charts present: compliance-chart, violations-chart
  charts.complianceChart = updateComplianceChart("compliance-chart", charts.complianceChart, red, yellow, green);
  charts.violationsChart = updateViolationsChart("violations-chart", charts.violationsChart, data);
  // amount chart is optional in the current HTML; safe call keeps null if canvas missing
  charts.amountChart = updateAmountChart("amount-chart", charts.amountChart, auditResults, glData);
  return charts;
}
