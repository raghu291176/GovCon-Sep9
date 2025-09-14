import * as fuzz from 'fuzzball';
import moment from 'moment';
import { areVendorsEquivalent } from './vendorResolver.js';

// Normalize vendor/merchant names for better matching
const CORP_SUFFIXES = [
  'inc', 'inc.', 'llc', 'l.l.c', 'ltd', 'ltd.', 'co', 'co.', 'corp', 'corp.', 'corporation', 'company',
  'pte', 'pte.', 'gmbh', 's.a.', 's.a', 's.l.', 'srl', 'bv', 'oy', 'ab', 'sa', 'spa', 'plc',
  // generic words often appended
  'business', 'supercenter', 'marketplace', 'online', 'store', 'the', 'and'
];

function cleanVendorName(name) {
  if (!name) return '';
  let s = String(name).toLowerCase();
  s = s.replace(/[^a-z0-9\s]/g, ' '); // remove punctuation
  s = s.replace(/\s+/g, ' ').trim();
  const parts = s.split(' ').filter(p => p && !CORP_SUFFIXES.includes(p));
  return parts.join(' ').trim();
}

function vendorSimilarity(a, b) {
  const ca = cleanVendorName(a);
  const cb = cleanVendorName(b);
  if (!ca || !cb) return 0;
  const r = fuzz.ratio(ca, cb) / 100;
  const ts = fuzz.token_set_ratio(ca, cb) / 100;
  const pr = fuzz.partial_ratio(ca, cb) / 100;
  return Math.max(r, ts, pr);
}

function calculateMatchScore(extractedData, glEntry, weightCfg = {}) {
  // Weights default
  const weights = {
    amount: weightCfg.amount ?? 0.45,
    date: weightCfg.date ?? 0.35,
    vendor: weightCfg.vendor ?? 0.20
  };

  // Amount sub-score in [0,1]
  let amountScore = 0;
  if (extractedData.amount?.value && typeof glEntry.amount === 'number') {
    const diff = Math.abs(extractedData.amount.value - glEntry.amount);
    if (diff <= 0.01) amountScore = 1;
    else if (diff <= 1) amountScore = 0.8;
    else if (diff <= 5) amountScore = 0.6;
    else if (diff <= 10) amountScore = 0.4;
    else if (diff <= 25) amountScore = 0.2;
    else amountScore = 0;
  }

  // Date sub-score in [0,1]
  let dateScore = 0;
  if (extractedData.date?.value && glEntry.date) {
    const d1 = moment(extractedData.date.value);
    const d2 = moment(glEntry.date);
    const dd = Math.abs(d1.diff(d2, 'days'));
    if (dd === 0) dateScore = 1;
    else if (dd <= 1) dateScore = 0.85;
    else if (dd <= 3) dateScore = 0.7;
    else if (dd <= 7) dateScore = 0.5;
    else if (dd <= 14) dateScore = 0.25;
    else dateScore = 0;
  }

  // Vendor sub-score in [0,1]
  let vendorScore = 0;
  if (extractedData.merchant?.value && glEntry.vendor) {
    vendorScore = vendorSimilarity(extractedData.merchant.value, glEntry.vendor);
  }

  // Exact-match boost
  const exactCombo = amountScore === 1 && dateScore >= 0.85 && vendorScore >= 0.85;
  if (exactCombo) return 100;

  // Combine weighted
  let combined = (amountScore * weights.amount) + (dateScore * weights.date) + (vendorScore * weights.vendor);

  // Penalty if vendor extremely low and others weak
  if (vendorScore < 0.3 && amountScore < 0.6 && dateScore < 0.7) {
    combined *= 0.7;
  }

  return Math.round(Math.min(combined, 1) * 100);
}

async function findGLMatches(extractedData, glEntries, options = {}) {
    const {
        maxDateDiff = 14,
        maxAmountDiff = 50.00,
        minScore = 50,
        maxResults = 10
    } = options;
    
    const candidateEntries = glEntries.filter(entry => {
        if (!entry) return false;

        if (extractedData.date?.value && entry.date) {
            const extractedDate = moment(extractedData.date.value);
            const glDate = moment(entry.date);
            const daysDiff = Math.abs(extractedDate.diff(glDate, 'days'));

            if (daysDiff > maxDateDiff) return false;
        }

        if (extractedData.amount?.value && entry.amount) {
            const amountDiff = Math.abs(extractedData.amount.value - entry.amount);
            if (amountDiff > maxAmountDiff) return false;
        }

        return true;
    });
    
    const matches = [];
    
    for (const glEntry of candidateEntries) {
        let score = calculateMatchScore(extractedData, glEntry, options.weights || {});
        let vendorEq = false;
        let vendorBoost = 0;

        // Optional GPT assist for borderline vendor similarity cases
        if (process.env.VENDOR_NAME_GPT_ENABLED && extractedData.merchant?.value && glEntry.vendor) {
            const sim = vendorSimilarity(extractedData.merchant.value, glEntry.vendor);
            if (sim >= 0.4 && sim < 0.75 && score < (minScore + 10)) {
                try {
                    const res = await areVendorsEquivalent(extractedData.merchant.value, glEntry.vendor);
                    if (res?.equivalent) {
                        vendorEq = true;
                        vendorBoost = 15; // trust boost for equivalence
                        score = Math.min(100, score + vendorBoost);
                    }
                } catch (_) {}
            }
        }
        
        if (score >= minScore) {
            matches.push({
                gl_entry_id: glEntry.id,
                match_score: Math.round(score * 100) / 100,
                match_type: score >= 90 ? 'primary' : score >= 75 ? 'strong' : 'candidate',
                gl_amount: glEntry.amount,
                gl_date: glEntry.date,
                gl_vendor: glEntry.vendor,
                gl_description: glEntry.description || null,
                gl_account: glEntry.account || null,
                discrepancies: identifyDiscrepancies(extractedData, glEntry),
                confidence_factors: calculateConfidenceFactors(extractedData, glEntry, score),
                signals: {
                  vendor_similarity: extractedData.merchant?.value && glEntry.vendor ? vendorSimilarity(extractedData.merchant.value, glEntry.vendor) : null,
                  amount_diff: (extractedData.amount?.value && typeof glEntry.amount === 'number') ? Math.abs(extractedData.amount.value - glEntry.amount) : null,
                  date_diff_days: (extractedData.date?.value && glEntry.date) ? Math.abs(moment(extractedData.date.value).diff(moment(glEntry.date), 'days')) : null,
                  gpt_vendor_equivalent: vendorEq,
                  gpt_vendor_boost: vendorBoost
                }
            });
        }
    }
    
    matches.sort((a, b) => b.match_score - a.match_score);
    
    return matches.slice(0, maxResults);
}

function identifyDiscrepancies(extractedData, glEntry) {
    const discrepancies = [];

    if (extractedData.amount?.value && glEntry.amount) {
        const amountDiff = Math.abs(extractedData.amount.value - glEntry.amount);
        if (amountDiff > 0.01) {
            discrepancies.push({
                field: 'amount',
                extracted: extractedData.amount.value,
                gl_value: glEntry.amount,
                difference: Math.round(amountDiff * 100) / 100,
                percentage_diff: Math.round((amountDiff / glEntry.amount) * 10000) / 100
            });
        }
    }

    if (extractedData.date?.value && glEntry.date) {
        const extractedDate = moment(extractedData.date.value);
        const glDate = moment(glEntry.date);
        const daysDiff = extractedDate.diff(glDate, 'days');

        if (daysDiff !== 0) {
            discrepancies.push({
                field: 'date',
                extracted: extractedData.date.value,
                gl_value: glEntry.date,
                days_difference: daysDiff,
                direction: daysDiff > 0 ? 'later' : 'earlier'
            });
        }
    }

    if (extractedData.merchant?.value && glEntry.vendor) {
        const similarity = vendorSimilarity(extractedData.merchant.value, glEntry.vendor);

        if (similarity < 0.9) {
            discrepancies.push({
                field: 'vendor',
                extracted: extractedData.merchant.value,
                gl_value: glEntry.vendor,
                similarity_score: Math.round(similarity * 10000) / 100
            });
        }
    }

    return discrepancies;
}

function calculateConfidenceFactors(extractedData, glEntry, matchScore) {
    const factors = {
        amount_confidence: extractedData.amount?.confidence || 0,
        date_confidence: extractedData.date?.confidence || 0,
        merchant_confidence: extractedData.merchant?.confidence || 0,
        match_score: matchScore,
        overall_confidence: 0
    };
    
    const weights = {
        amount: 0.4,
        date: 0.35,
        merchant: 0.25
    };
    
    factors.overall_confidence = 
        (factors.amount_confidence * weights.amount) +
        (factors.date_confidence * weights.date) +
        (factors.merchant_confidence * weights.merchant);
    
    factors.overall_confidence = Math.round(factors.overall_confidence * 100) / 100;
    
    return factors;
}

function validateGLEntry(glEntry) {
    if (!glEntry) return false;
    if (!glEntry.id) return false;
    if (typeof glEntry.amount !== 'number') return false;
    if (!glEntry.date) return false;
    
    const dateValid = moment(glEntry.date).isValid();
    if (!dateValid) return false;
    
    return true;
}

function preprocessGLEntries(glEntries) {
    return glEntries.filter(validateGLEntry).map(entry => ({
        ...entry,
        vendor: entry.vendor ? entry.vendor.trim() : '',
        description: entry.description ? entry.description.trim() : '',
        date: moment(entry.date).format('YYYY-MM-DD')
    }));
}

async function findDuplicateMatches(extractedData, glEntries, existingMatches = []) {
    const duplicates = [];
    const matchedGLIds = new Set(existingMatches.map(match => match.gl_entry_id));
    
    for (const glEntry of glEntries) {
        if (matchedGLIds.has(glEntry.id)) {
            const score = calculateMatchScore(extractedData, glEntry);
            if (score >= 70) {
                duplicates.push({
                    gl_entry_id: glEntry.id,
                    match_score: score,
                    status: 'already_matched',
                    original_match_id: existingMatches.find(m => m.gl_entry_id === glEntry.id)?.match_id
                });
            }
        }
    }
    
    return duplicates;
}

export {
    calculateMatchScore,
    findGLMatches,
    identifyDiscrepancies,
    calculateConfidenceFactors,
    validateGLEntry,
    preprocessGLEntries,
    findDuplicateMatches
};
