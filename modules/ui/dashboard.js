import { updateComplianceChart, updateViolationsChart, updateAmountChart } from "./charts.js";

export function updateStatistics(total, red, yellow, green) {
  const totalElement = document.getElementById("total-items");
  const redElement = document.getElementById("red-count");
  const yellowElement = document.getElementById("yellow-count");
  const greenElement = document.getElementById("green-count");

  if (totalElement) totalElement.textContent = total;
  if (redElement) redElement.textContent = red;
  if (yellowElement) yellowElement.textContent = yellow;
  if (greenElement) greenElement.textContent = green;
}

export function updateDashboard(auditResults, glData, charts) {
  const results = auditResults || [];
  if (results.length === 0) {
    const total = (glData || []).length;
    updateStatistics(total, 0, 0, 0);
    charts.complianceChart = updateComplianceChart(
      "compliance-chart",
      charts.complianceChart,
      0,
      0,
      0
    );
    charts.violationsChart = updateViolationsChart(
      "violations-chart",
      charts.violationsChart,
      results
    );
    charts.amountChart = updateAmountChart(
      "amount-chart",
      charts.amountChart,
      results,
      glData
    );
    return charts;
  }

  const totalItems = results.length;
  const redCount = results.filter((i) => i.status === "RED").length;
  const yellowCount = results.filter((i) => i.status === "YELLOW").length;
  const greenCount = results.filter((i) => i.status === "GREEN").length;

  updateStatistics(totalItems, redCount, yellowCount, greenCount);
  charts.complianceChart = updateComplianceChart(
    "compliance-chart",
    charts.complianceChart,
    redCount,
    yellowCount,
    greenCount
  );
  charts.violationsChart = updateViolationsChart(
    "violations-chart",
    charts.violationsChart,
    results
  );
  charts.amountChart = updateAmountChart(
    "amount-chart",
    charts.amountChart,
    results,
    glData
  );
  return charts;
}
