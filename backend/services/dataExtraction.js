import moment from 'moment';

function extractAmount(fields) {
    const amountFields = [
        'Total', 'TotalAmount', 'Amount', 'InvoiceTotal',
        'Subtotal', 'SubtotalAmount', 'GrandTotal', 'AmountDue'
    ];
    
    for (const fieldName of amountFields) {
        if (fields[fieldName] && fields[fieldName].value !== undefined) {
            let value = fields[fieldName].value;
            
            if (typeof value === 'number') {
                return {
                    value: parseFloat(value.toFixed(2)),
                    confidence: fields[fieldName].confidence || 0
                };
            }
            
            if (typeof value === 'string') {
                const numericValue = parseFloat(value.replace(/[^0-9.-]/g, ''));
                if (!isNaN(numericValue)) {
                    return {
                        value: parseFloat(numericValue.toFixed(2)),
                        confidence: fields[fieldName].confidence || 0
                    };
                }
            }
        }
    }
    
    return { value: null, confidence: 0 };
}

function extractDate(fields) {
    const dateFields = [
        'TransactionDate', 'Date', 'InvoiceDate', 'ReceiptDate',
        'ServiceDate', 'PurchaseDate', 'DueDate'
    ];
    
    for (const fieldName of dateFields) {
        if (fields[fieldName] && fields[fieldName].value) {
            let dateValue = fields[fieldName].value;
            
            if (dateValue instanceof Date) {
                const formattedDate = moment(dateValue).format('MM/DD/YYYY');
                return {
                    value: formattedDate,
                    confidence: fields[fieldName].confidence || 0
                };
            }

            if (typeof dateValue === 'string') {
                const parsedDate = moment(dateValue);
                if (parsedDate.isValid()) {
                    return {
                        value: parsedDate.format('MM/DD/YYYY'),
                        confidence: fields[fieldName].confidence || 0
                    };
                }
            }
        }
    }
    
    return { value: null, confidence: 0 };
}

function extractMerchant(fields) {
    const merchantFields = [
        'MerchantName', 'VendorName', 'CompanyName', 'BusinessName',
        'StoreName', 'SupplierName', 'Name'
    ];
    
    for (const fieldName of merchantFields) {
        if (fields[fieldName] && fields[fieldName].value) {
            let merchantValue = fields[fieldName].value;
            
            if (typeof merchantValue === 'string') {
                return {
                    value: merchantValue.trim(),
                    confidence: fields[fieldName].confidence || 0
                };
            }
            
            if (typeof merchantValue === 'object' && merchantValue.content) {
                return {
                    value: merchantValue.content.trim(),
                    confidence: fields[fieldName].confidence || 0
                };
            }
        }
    }
    
    return { value: null, confidence: 0 };
}

function extractVendor(fields) {
    const vendorFields = [
        'VendorName', 'VendorAddress', 'BillingAddress', 'From',
        'SupplierName', 'CompanyName', 'BusinessName'
    ];
    
    for (const fieldName of vendorFields) {
        if (fields[fieldName] && fields[fieldName].value) {
            let vendorValue = fields[fieldName].value;
            
            if (typeof vendorValue === 'object' && vendorValue.content) {
                vendorValue = vendorValue.content;
            }
            
            if (typeof vendorValue === 'string') {
                return {
                    value: vendorValue.trim(),
                    confidence: fields[fieldName].confidence || 0
                };
            }
        }
    }
    
    return { value: null, confidence: 0 };
}

function extractLineItems(fields) {
    const items = [];
    
    if (fields.Items && Array.isArray(fields.Items.value)) {
        fields.Items.value.forEach((item, index) => {
            const itemFields = item.value || {};
            
            items.push({
                description: itemFields.Description ? itemFields.Description.value : null,
                quantity: itemFields.Quantity ? parseFloat(itemFields.Quantity.value) : null,
                unitPrice: itemFields.UnitPrice ? parseFloat(itemFields.UnitPrice.value) : null,
                totalPrice: itemFields.TotalPrice ? parseFloat(itemFields.TotalPrice.value) : null,
                confidence: item.confidence || 0
            });
        });
    }
    
    return items;
}

function extractTaxDetails(fields) {
    const taxFields = ['Tax', 'TaxAmount', 'SalesTax', 'VAT', 'TotalTax'];
    
    for (const fieldName of taxFields) {
        if (fields[fieldName] && fields[fieldName].value !== undefined) {
            let value = fields[fieldName].value;
            
            if (typeof value === 'number') {
                return {
                    value: parseFloat(value.toFixed(2)),
                    confidence: fields[fieldName].confidence || 0
                };
            }
            
            if (typeof value === 'string') {
                const numericValue = parseFloat(value.replace(/[^0-9.-]/g, ''));
                if (!isNaN(numericValue)) {
                    return {
                        value: parseFloat(numericValue.toFixed(2)),
                        confidence: fields[fieldName].confidence || 0
                    };
                }
            }
        }
    }
    
    return { value: null, confidence: 0 };
}

function extractPaymentDetails(fields) {
    const paymentInfo = {
        method: { value: null, confidence: 0 },
        accountNumber: { value: null, confidence: 0 },
        referenceNumber: { value: null, confidence: 0 }
    };
    
    if (fields.PaymentMethod && fields.PaymentMethod.value) {
        paymentInfo.method = {
            value: fields.PaymentMethod.value.toString(),
            confidence: fields.PaymentMethod.confidence || 0
        };
    }
    
    if (fields.AccountNumber && fields.AccountNumber.value) {
        paymentInfo.accountNumber = {
            value: fields.AccountNumber.value.toString(),
            confidence: fields.AccountNumber.confidence || 0
        };
    }
    
    if (fields.ReferenceNumber && fields.ReferenceNumber.value) {
        paymentInfo.referenceNumber = {
            value: fields.ReferenceNumber.value.toString(),
            confidence: fields.ReferenceNumber.confidence || 0
        };
    }
    
    return paymentInfo;
}

export {
    extractAmount,
    extractDate,
    extractMerchant,
    extractVendor,
    extractLineItems,
    extractTaxDetails,
    extractPaymentDetails
};