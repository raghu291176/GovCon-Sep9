export function auditItem(item, farRules, options = {}) {
  const description = (item.description || "").toLowerCase();
  let status = "GREEN";
  let farIssue = "Compliant";
  let farSection = "";

  for (const rule of farRules) {
    for (const keyword of rule.keywords) {
      if (description.includes(keyword.toLowerCase())) {
        if (rule.severity === "EXPRESSLY_UNALLOWABLE") {
          status = "RED";
        } else if (rule.severity === "LIMITED_ALLOWABLE") {
          status = "YELLOW";
        }
        farIssue = `${rule.title} (${rule.section})`;
        farSection = rule.section;
        break;
      }
    }
    if (status !== "GREEN") break;
  }

  // Removed amount-based threshold classification. GL review is rule-driven only.

  return { status, farIssue, farSection };
}

export function auditAll(glData, farRules, options = {}) {
  return (glData || []).map((item) => ({ ...item, ...auditItem(item, farRules, options) }));
}
