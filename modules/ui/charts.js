// Chart.js helpers (Chart is provided globally by CDN)

export function updateComplianceChart(canvasId, prevChart, red, yellow, green) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return prevChart || null;
  
  // Check if Chart.js is available
  if (typeof Chart === 'undefined') {
    console.warn('Chart.js not loaded - charts will not display');
    return prevChart || null;
  }
  
  const total = (red || 0) + (yellow || 0) + (green || 0);
  if (total === 0) {
    if (prevChart) prevChart.destroy();
    return null;
  }
  const ctx = canvas.getContext("2d");
  if (prevChart) prevChart.destroy();
  return new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Expressly Unallowable", "Requires Review", "Compliant"],
      datasets: [
        {
          data: [red, yellow, green],
          backgroundColor: ["#B4413C", "#FFC185", "#1FB8CD"],
          borderWidth: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom" },
      },
    },
  });
}

export function updateViolationsChart(canvasId, prevChart, auditResults) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return prevChart || null;
  
  // Check if Chart.js is available
  if (typeof Chart === 'undefined') {
    console.warn('Chart.js not loaded - charts will not display');
    return prevChart || null;
  }

  const violations = {};
  (auditResults || []).forEach((item) => {
    if (item.status === "RED" && item.farSection) {
      violations[item.farSection] = (violations[item.farSection] || 0) + 1;
    }
  });
  if (Object.keys(violations).length === 0) {
    if (prevChart) prevChart.destroy();
    return null;
  }

  const ctx = canvas.getContext("2d");
  if (prevChart) prevChart.destroy();
  return new Chart(ctx, {
    type: "bar",
    data: {
      labels: Object.keys(violations),
      datasets: [
        {
          label: "Violations",
          data: Object.values(violations),
          backgroundColor: "#B4413C",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
    },
  });
}

export function updateAmountChart(canvasId, prevChart, auditResults, glData) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return prevChart || null;
  
  // Check if Chart.js is available
  if (typeof Chart === 'undefined') {
    console.warn('Chart.js not loaded - charts will not display');
    return prevChart || null;
  }

  const amounts = { RED: 0, YELLOW: 0, GREEN: 0 };
  const data = (auditResults && auditResults.length > 0) ? auditResults : glData || [];
  if (data.length === 0) {
    if (prevChart) prevChart.destroy();
    return null;
  }
  data.forEach((item) => {
    const key = item.status || "GREEN";
    amounts[key] = (amounts[key] || 0) + (item.amount || 0);
  });

  const ctx = canvas.getContext("2d");
  if (prevChart) prevChart.destroy();
  return new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["Expressly Unallowable", "Requires Review", "Compliant"],
      datasets: [
        {
          label: "Amount ($)",
          data: [amounts.RED, amounts.YELLOW, amounts.GREEN],
          backgroundColor: ["#B4413C", "#FFC185", "#1FB8CD"],
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: function (value) {
              return "$" + value.toLocaleString();
            },
          },
        },
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: function (context) {
              return context.dataset.label + ": $" + context.parsed.y.toLocaleString();
            },
          },
        },
      },
    },
  });
}
