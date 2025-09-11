import * as fuzz from 'fuzzball';
import moment from 'moment';

function calculateMatchScore(extractedData, glEntry) {
    let score = 0;
    
    if (extractedData.amount.value && glEntry.amount) {
        const amountDiff = Math.abs(extractedData.amount.value - glEntry.amount);
        if (amountDiff <= 0.01) {
            score += 40;
        } else if (amountDiff <= 1.00) {
            score += 30;
        } else if (amountDiff <= 5.00) {
            score += 20;
        } else if (amountDiff <= 10.00) {
            score += 10;
        }
    }
    
    if (extractedData.date.value && glEntry.date) {
        const extractedDate = moment(extractedData.date.value);
        const glDate = moment(glEntry.date);
        const daysDiff = Math.abs(extractedDate.diff(glDate, 'days'));
        
        if (daysDiff === 0) {
            score += 35;
        } else if (daysDiff <= 1) {
            score += 30;
        } else if (daysDiff <= 3) {
            score += 25;
        } else if (daysDiff <= 7) {
            score += 15;
        } else if (daysDiff <= 14) {
            score += 5;
        }
    }
    
    if (extractedData.merchant.value && glEntry.vendor) {
        const similarity = fuzz.ratio(
            extractedData.merchant.value.toLowerCase(),
            glEntry.vendor.toLowerCase()
        ) / 100;
        
        if (similarity >= 0.9) {
            score += 25;
        } else if (similarity >= 0.8) {
            score += 20;
        } else if (similarity >= 0.7) {
            score += 15;
        } else if (similarity >= 0.6) {
            score += 10;
        } else if (similarity >= 0.5) {
            score += 5;
        }
    }
    
    return Math.min(score, 100);
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
        
        if (extractedData.date.value && entry.date) {
            const extractedDate = moment(extractedData.date.value);
            const glDate = moment(entry.date);
            const daysDiff = Math.abs(extractedDate.diff(glDate, 'days'));
            
            if (daysDiff > maxDateDiff) return false;
        }
        
        if (extractedData.amount.value && entry.amount) {
            const amountDiff = Math.abs(extractedData.amount.value - entry.amount);
            if (amountDiff > maxAmountDiff) return false;
        }
        
        return true;
    });
    
    const matches = [];
    
    for (const glEntry of candidateEntries) {
        const score = calculateMatchScore(extractedData, glEntry);
        
        if (score >= minScore) {
            matches.push({
                gl_entry_id: glEntry.id,
                match_score: Math.round(score * 100) / 100,
                match_type: score >= 85 ? 'primary' : score >= 70 ? 'strong' : 'candidate',
                gl_amount: glEntry.amount,
                gl_date: glEntry.date,
                gl_vendor: glEntry.vendor,
                gl_description: glEntry.description || null,
                gl_account: glEntry.account || null,
                discrepancies: identifyDiscrepancies(extractedData, glEntry),
                confidence_factors: calculateConfidenceFactors(extractedData, glEntry, score)
            });
        }
    }
    
    matches.sort((a, b) => b.match_score - a.match_score);
    
    return matches.slice(0, maxResults);
}

function identifyDiscrepancies(extractedData, glEntry) {
    const discrepancies = [];
    
    if (extractedData.amount.value && glEntry.amount) {
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
    
    if (extractedData.date.value && glEntry.date) {
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
    
    if (extractedData.merchant.value && glEntry.vendor) {
        const similarity = fuzz.ratio(
            extractedData.merchant.value.toLowerCase(),
            glEntry.vendor.toLowerCase()
        ) / 100;
        
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
        amount_confidence: extractedData.amount.confidence || 0,
        date_confidence: extractedData.date.confidence || 0,
        merchant_confidence: extractedData.merchant.confidence || 0,
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