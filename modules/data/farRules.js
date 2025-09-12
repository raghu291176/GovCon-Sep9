// Enhanced FAR Rules Data with Additional Rules and Better Coverage
// Updated with more keywords, new rules, and comprehensive descriptions

export const farRules = [
  // EXPRESSLY UNALLOWABLE COSTS (RED FLAGS)
  {
    section: "31.205-51",
    title: "Alcoholic Beverages",
    severity: "EXPRESSLY_UNALLOWABLE",
    keywords: [
      "alcohol", "wine", "beer", "spirits", "liquor", "champagne", "cocktail", 
      "bourbon", "whiskey", "vodka", "rum", "gin", "brandy", "sangria", "margarita", 
      "bar", "tavern", "brewery", "distillery", "pub", "nightclub", "winery",
      "brewpub", "ale", "lager", "porter", "stout", "cider", "mead", "sake",
      "aperitif", "digestif", "liqueur", "schnapps", "tequila", "absinthe",
      "wine cellar", "bar tab", "bottle service", "wine tasting", "happy hour"
    ],
    description: "Costs of alcoholic beverages are expressly unallowable under all circumstances, including entertainment, meetings, or any business purpose."
  },

  {
    section: "31.205-22",
    title: "Lobbying and Political Activity",
    severity: "EXPRESSLY_UNALLOWABLE",
    keywords: [
      "lobbying", "lobbyist", "political", "campaign", "pac", "super pac", 
      "grassroots", "legislative liaison", "political contribution", "election",
      "candidate", "politician", "congress", "senate", "house", "representative",
      "senator", "political party", "democrat", "republican", "independent",
      "fundraiser", "political event", "ballot initiative", "referendum",
      "political consultant", "government affairs", "advocacy", "influence"
    ],
    description: "Costs associated with lobbying and political activities are expressly unallowable, including contributions, influence activities, and related expenses."
  },

  {
    section: "31.205-8",
    title: "Contributions or Donations",
    severity: "EXPRESSLY_UNALLOWABLE",
    keywords: [
      "donation", "contribution", "charity", "charitable", "nonprofit", 
      "foundation", "sponsorship", "pledge", "gift", "endowment", "grant",
      "scholarship", "humanitarian", "philanthropic", "community support",
      "united way", "red cross", "salvation army", "goodwill", "charitable giving",
      "fundraising", "benefit", "cause", "social responsibility", "giving back"
    ],
    description: "Contributions and donations, including cash, property, and services to external organizations, are unallowable regardless of the charitable purpose."
  },

  {
    section: "31.205-20",
    title: "Interest and Other Financial Costs",
    severity: "EXPRESSLY_UNALLOWABLE",
    keywords: [
      "interest expense", "loan interest", "financing fee", "bank fee", 
      "credit line fee", "factoring fee", "credit card interest", "mortgage interest",
      "line of credit", "borrowing cost", "finance charge", "late payment fee",
      "overdraft fee", "loan origination", "commitment fee", "facility fee"
    ],
    description: "Interest on borrowings, financing fees, and related financial costs are unallowable as they represent the cost of money rather than contract performance."
  },

  {
    section: "31.205-14",
    title: "Entertainment Costs",
    severity: "EXPRESSLY_UNALLOWABLE",
    keywords: [
      "entertainment", "tickets", "show", "concert", "sports", "game", "golf", 
      "country club", "dining club", "social club", "theater", "movie", "cinema",
      "amusement", "diversion", "recreation", "party", "celebration", "gala", 
      "reception", "sporting event", "baseball", "football", "basketball", "hockey",
      "tennis", "boxing", "racing", "casino", "gambling", "nightclub", "strip club",
      "comedy show", "broadway", "opera", "ballet", "cruise", "yacht"
    ],
    description: "Costs of amusement, diversions, social activities and directly associated costs (transportation, meals, lodging) are unallowable."
  },

  {
    section: "31.205-13",
    title: "Employee Morale - Gifts and Recreational Activities",
    severity: "EXPRESSLY_UNALLOWABLE",
    keywords: [
      "gift", "flowers", "gift card", "present", "souvenir", "trophy", "award", 
      "plaque", "memento", "promotional item", "giveaway", "prize", "bonus gift",
      "holiday gift", "birthday gift", "anniversary gift", "retirement gift",
      "welcome gift", "appreciation gift", "thank you gift", "incentive gift",
      "company picnic", "holiday party", "office party", "team building",
      "recreational activity", "employee outing", "fun run", "wellness program"
    ],
    description: "Costs of gifts and recreational activities for employee morale are unallowable, except for company-sponsored sports teams."
  },

  {
    section: "31.205-3",
    title: "Bad Debts",
    severity: "EXPRESSLY_UNALLOWABLE",
    keywords: [
      "bad debt", "uncollectible", "write-off", "collection cost", "debt collection",
      "default", "bankruptcy", "insolvency", "charge-off", "provision for losses",
      "doubtful accounts", "delinquent", "past due", "collection agency",
      "debt forgiveness", "settlement discount", "loss on receivables"
    ],
    description: "Actual or estimated losses from uncollectible accounts and related collection costs are unallowable."
  },

  {
    section: "31.205-15",
    title: "Fines and Penalties",
    severity: "EXPRESSLY_UNALLOWABLE",
    keywords: [
      "fine", "penalty", "violation", "citation", "infraction", "late fee", 
      "interest penalty", "civil penalty", "criminal fine", "regulatory fine",
      "osha fine", "epa penalty", "tax penalty", "compliance penalty",
      "court fine", "punitive damages", "sanctions", "forfeiture"
    ],
    description: "Costs of fines, penalties, and punitive damages for violating laws, regulations, or contract terms are unallowable."
  },

  {
    section: "31.205-41",
    title: "Federal Income Tax",
    severity: "EXPRESSLY_UNALLOWABLE",
    keywords: [
      "federal income tax", "corporate income tax", "irs income tax",
      "income tax provision", "tax expense", "federal tax"
    ],
    description: "Federal income and excess profits taxes are unallowable. State, local, and foreign income taxes may be allowable."
  },

  // LIMITED ALLOWABLE COSTS (YELLOW FLAGS - REQUIRE REVIEW)
  {
    section: "31.205-46",
    title: "Travel Costs - General",
    severity: "LIMITED_ALLOWABLE",
    keywords: [
      "travel", "airfare", "flight", "hotel", "lodging", "per diem", "mileage", 
      "taxi", "rideshare", "uber", "lyft", "car rental", "train", "bus",
      "accommodation", "meals and incidental", "m&ie", "travel allowance",
      "transportation", "parking", "tolls", "gas", "fuel", "airport shuttle"
    ],
    description: "Travel costs are allowable when reasonable, necessary for contract performance, and properly documented. Subject to limitations on class of service and rates."
  },

  {
    section: "31.205-46(b)",
    title: "Premium Airfare (First/Business Class)",
    severity: "LIMITED_ALLOWABLE",
    keywords: [
      "first class", "business class", "premium economy", "seat upgrade", 
      "class upgrade", "cabin upgrade", "fare upgrade", "upgrade fee",
      "priority boarding", "lounge access", "premium seating", "extra legroom",
      "comfort class", "preferred seating", "exit row"
    ],
    description: "Airfare costs are allowable only up to coach/economy class. Premium cabin costs in excess of coach are unallowable unless justified by medical or security reasons and properly documented."
  },

  {
    section: "31.205-33",
    title: "Professional and Consultant Service Costs",
    severity: "LIMITED_ALLOWABLE",
    keywords: [
      "consultant", "consulting", "legal", "attorney", "law firm", "accountant", 
      "cpa", "professional fees", "retainer", "expert witness", "advisor",
      "specialist", "contractor", "freelancer", "independent contractor",
      "professional services", "technical assistance", "audit fees"
    ],
    description: "Professional and consultant costs are allowable when reasonable, necessary, and supported by evidence of services rendered. Must demonstrate necessity and reasonableness."
  },

  {
    section: "31.205-47",
    title: "Costs Related to Legal and Other Proceedings",
    severity: "LIMITED_ALLOWABLE",
    keywords: [
      "lawsuit", "litigation", "settlement", "consent decree", "investigation", 
      "whistleblower", "legal proceeding", "court case", "arbitration",
      "mediation", "dispute resolution", "legal defense", "prosecution",
      "regulatory proceeding", "administrative proceeding"
    ],
    description: "Legal proceeding costs may be unallowable if resulting from violations or fraud. Costs for successful defense or proceedings required for contract performance may be allowable."
  },

  {
    section: "31.205-43",
    title: "Trade, Business, Technical and Professional Activities",
    severity: "LIMITED_ALLOWABLE",
    keywords: [
      "membership dues", "dues", "subscription", "professional society", 
      "association fee", "certification fee", "license fee", "trade association",
      "chamber of commerce", "professional membership", "technical society",
      "industry association", "certification maintenance", "continuing education"
    ],
    description: "Memberships in civic, community, or social organizations are generally unallowable. Technical and professional societies directly related to work may be allowable."
  },

  {
    section: "31.205-30",
    title: "Patent and Copyright Costs",
    severity: "LIMITED_ALLOWABLE",
    keywords: [
      "patent", "trademark", "copyright", "ip filing", "uspto", "patent attorney", 
      "filing fee", "intellectual property", "patent application", "trademark registration",
      "copyright registration", "patent prosecution", "ip protection", "patent search",
      "prior art", "patent maintenance"
    ],
    description: "Patent costs related to contract work are generally allowable. Costs for patents unrelated to government work or patent litigation may be unallowable."
  },

  {
    section: "31.205-36",
    title: "Rental Costs",
    severity: "LIMITED_ALLOWABLE",
    keywords: [
      "rent", "rental", "lease", "lease payment", "equipment lease", 
      "facility lease", "office rent", "warehouse rent", "vehicle lease",
      "equipment rental", "facility rental", "space rental", "real estate lease"
    ],
    description: "Rental costs under operating leases are allowable with restrictions. Sale-leaseback arrangements and related-party rentals require special consideration."
  },

  {
    section: "31.205-34",
    title: "Recruitment Costs",
    severity: "LIMITED_ALLOWABLE",
    keywords: [
      "recruiting", "recruiter", "candidate travel", "signing bonus", 
      "job posting", "headhunter", "recruitment agency", "job fair",
      "employment agency", "recruitment advertising", "interview expenses",
      "relocation allowance", "finder's fee"
    ],
    description: "Recruitment costs are allowable when reasonable and necessary. Excessive or lavish recruiting expenses and gifts to candidates are unallowable."
  },

  {
    section: "31.205-35",
    title: "Relocation Costs",
    severity: "LIMITED_ALLOWABLE",
    keywords: [
      "relocation", "moving expense", "temporary housing", "house hunting", 
      "relocation bonus", "moving company", "household goods", "storage",
      "temporary lodging", "duplicate expenses", "home sale assistance",
      "lease termination", "utility connection"
    ],
    description: "Relocation costs are allowable with limitations including time restrictions, documentation requirements, and repayment provisions if employee leaves early."
  },

  {
    section: "31.205-44",
    title: "Training and Education Costs",
    severity: "LIMITED_ALLOWABLE",
    keywords: [
      "training", "tuition", "course", "seminar", "workshop", "education", 
      "certification training", "conference", "symposium", "continuing education",
      "professional development", "skill training", "degree program",
      "executive education", "mba", "online course", "webinar"
    ],
    description: "Training and education costs are generally allowable when job-related. Degree programs and general education may have limitations and require justification."
  },

  {
    section: "31.205-6",
    title: "Compensation - Executive and Bonus Limits",
    severity: "LIMITED_ALLOWABLE",
    keywords: [
      "executive compensation", "bonus", "incentive pay", "severance", 
      "termination pay", "golden parachute", "stock options", "deferred compensation",
      "retention bonus", "performance bonus", "executive benefits",
      "compensation over benchmark", "excessive compensation"
    ],
    description: "Compensation must be reasonable and may be subject to benchmarking and caps. Excessive compensation, certain bonuses, and severance payments have specific limitations."
  },

  {
    section: "31.205-1",
    title: "Public Relations and Advertising",
    severity: "LIMITED_ALLOWABLE",
    keywords: [
      "advertising", "marketing", "promotion", "public relations", "publicity", 
      "brochure", "advertisement", "media buy", "promotional materials",
      "trade show", "exhibition", "marketing campaign", "brand awareness",
      "corporate communications", "press release", "website development"
    ],
    description: "Advertising and public relations costs are allowable only when specifically required by contract or directly arising from contract requirements."
  },

  // NEW RULES - ADDITIONAL FAR COVERAGE
  {
    section: "31.205-19",
    title: "Insurance and Indemnification",
    severity: "LIMITED_ALLOWABLE",
    keywords: [
      "insurance", "premium", "liability insurance", "property insurance",
      "workers compensation", "general liability", "professional liability",
      "errors and omissions", "director and officer", "d&o insurance",
      "cyber liability", "indemnification", "self-insurance"
    ],
    description: "Insurance costs are generally allowable when the contractor is the beneficiary and coverage is consistent with sound business practice. Self-insurance and certain coverage types have limitations."
  },

  {
    section: "31.205-26",
    title: "Material Costs",
    severity: "LIMITED_ALLOWABLE",
    keywords: [
      "raw materials", "supplies", "inventory", "component parts",
      "subassembly", "material handling", "freight", "shipping",
      "material overhead", "procurement", "purchase price variance"
    ],
    description: "Material costs are allowable when reasonable and allocable to the contract. Special considerations apply to material handling, related-party purchases, and inventory practices."
  },

  {
    section: "31.205-38",
    title: "Selling Costs",
    severity: "LIMITED_ALLOWABLE",
    keywords: [
      "selling expense", "sales commission", "sales travel", "sales meeting",
      "customer entertainment", "sales promotion", "marketing representative",
      "sales force", "customer relations", "trade show selling"
    ],
    description: "Selling costs are generally unallowable except when incurred in the performance of contract requirements or when specifically allowed by contract terms."
  },

  {
    section: "31.205-42",
    title: "Termination Costs",
    severity: "LIMITED_ALLOWABLE",
    keywords: [
      "termination cost", "contract termination", "settlement expense",
      "early termination", "cancellation fee", "termination for convenience",
      "termination for default", "subcontract termination", "inventory disposal"
    ],
    description: "Termination costs are allowable when reasonable and properly allocable. Costs vary depending on whether termination is for convenience or default."
  },

  {
    section: "31.205-24",
    title: "Maintenance and Repair Costs",
    severity: "LIMITED_ALLOWABLE",
    keywords: [
      "maintenance", "repair", "upkeep", "service contract", "warranty",
      "preventive maintenance", "equipment service", "facility maintenance",
      "building repair", "equipment repair", "maintenance agreement"
    ],
    description: "Maintenance and repair costs necessary to keep property in efficient operating condition are allowable. Improvements and betterments may be treated as capital expenditures."
  },

  {
    section: "31.205-49",
    title: "Goodwill",
    severity: "EXPRESSLY_UNALLOWABLE",
    keywords: [
      "goodwill", "intangible asset", "goodwill amortization",
      "business acquisition goodwill", "purchased goodwill"
    ],
    description: "Amortization of goodwill is unallowable regardless of how acquired or the accounting treatment."
  },

  {
    section: "31.205-25",
    title: "Manufacturing and Production Engineering Costs",
    severity: "LIMITED_ALLOWABLE",
    keywords: [
      "manufacturing engineering", "production engineering", "process improvement",
      "manufacturing support", "production planning", "industrial engineering",
      "tooling design", "process optimization", "lean manufacturing"
    ],
    description: "Manufacturing and production engineering costs are allowable when allocable to contract work and reasonable in relation to the benefits received."
  },

  {
    section: "31.205-37",
    title: "Royalty and License Costs",
    severity: "LIMITED_ALLOWABLE",
    keywords: [
      "royalty", "license fee", "licensing", "intellectual property license",
      "software license", "patent royalty", "trademark license",
      "technology license", "franchise fee"
    ],
    description: "Royalty and license costs are allowable when the intellectual property is used in contract performance. Related-party royalties require special consideration."
  },

  {
    section: "31.205-48",
    title: "Taxes (Non-Income)",
    severity: "LIMITED_ALLOWABLE",
    keywords: [
      "property tax", "sales tax", "use tax", "excise tax", "payroll tax",
      "state tax", "local tax", "personal property tax", "real estate tax",
      "employment tax", "social security tax", "unemployment tax"
    ],
    description: "Non-income taxes are generally allowable when based on cost included in contract price or incurred as a necessary expense of doing business."
  },

  {
    section: "31.205-45",
    title: "Utilities",
    severity: "LIMITED_ALLOWABLE",
    keywords: [
      "utilities", "electricity", "gas", "water", "sewer", "telephone",
      "internet", "telecommunications", "heating", "cooling", "power",
      "utility services", "energy costs"
    ],
    description: "Utility costs are allowable when reasonable and allocable to contract performance. Excessive consumption or luxury services may be questioned."
  },

  // HIGH-RISK CATEGORIES - ADDITIONAL SCRUTINY
  {
    section: "31.205-11",
    title: "Depreciation and Use Allowances",
    severity: "LIMITED_ALLOWABLE",
    keywords: [
      "depreciation", "use allowance", "asset depreciation", "equipment depreciation",
      "building depreciation", "accelerated depreciation", "bonus depreciation",
      "section 179", "capital asset", "useful life"
    ],
    description: "Depreciation is allowable using acceptable methods and useful lives. Special rules apply to assets used for both government and commercial work."
  },

  {
    section: "31.205-12",
    title: "Economic Planning Costs",
    severity: "LIMITED_ALLOWABLE",
    keywords: [
      "economic planning", "long range planning", "strategic planning",
      "business planning", "market research", "feasibility study",
      "economic analysis", "business development"
    ],
    description: "Economic planning costs for the contractor's overall economic planning are generally unallowable unless specifically related to contract performance."
  },

  {
    section: "31.205-27",
    title: "Organization Costs",
    severity: "LIMITED_ALLOWABLE",
    keywords: [
      "organization costs", "incorporation", "legal formation",
      "startup costs", "initial organization", "corporate formation",
      "partnership formation", "llc formation"
    ],
    description: "Organization costs incurred in connection with the initial organization of a corporation or partnership are allowable over a period of years."
  },

  // CYBERSECURITY AND MODERN ISSUES
  {
    section: "31.205-52",
    title: "Asset Valuations Resulting from Business Combinations",
    severity: "EXPRESSLY_UNALLOWABLE",
    keywords: [
      "business combination", "purchase price allocation", "fair value adjustment",
      "step-up basis", "intangible asset revaluation", "goodwill allocation"
    ],
    description: "Costs of assets that result from business combinations, when not supported by dependable evidence, are unallowable."
  }
];

// Additional validation rules for modern compliance issues
export const modernComplianceRules = [
  {
    section: "CYBER-1",
    title: "Cybersecurity Incident Response",
    severity: "LIMITED_ALLOWABLE",
    keywords: [
      "cybersecurity", "data breach", "cyber incident", "ransomware",
      "malware", "cyber attack", "security incident", "data recovery",
      "forensic investigation", "incident response", "cyber insurance claim"
    ],
    description: "Cybersecurity incident costs may be allowable if resulting from reasonable security measures and not due to contractor negligence."
  },

  {
    section: "COVID-1",
    title: "Pandemic-Related Costs",
    severity: "LIMITED_ALLOWABLE", 
    keywords: [
      "covid", "coronavirus", "pandemic", "ppe", "personal protective equipment",
      "sanitizer", "cleaning supplies", "remote work", "work from home",
      "social distancing", "quarantine", "contact tracing"
    ],
    description: "Pandemic-related costs are allowable when reasonable, necessary for employee safety, and required for contract performance."
  },

  {
    section: "ESG-1",
    title: "Environmental, Social, and Governance Initiatives",
    severity: "LIMITED_ALLOWABLE",
    keywords: [
      "sustainability", "environmental initiative", "carbon offset",
      "green energy", "social responsibility", "diversity program",
      "inclusion initiative", "esg reporting", "corporate social responsibility"
    ],
    description: "ESG costs are allowable only when specifically required by contract or regulation. General corporate social responsibility initiatives are typically unallowable."
  }
];