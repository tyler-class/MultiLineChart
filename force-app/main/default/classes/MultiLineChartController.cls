public with sharing class MultiLineChartController {
    public class ChartResponse {
        @AuraEnabled public List<String> fields;
        @AuraEnabled public String dateField;
        @AuraEnabled public List<Map<String, Object>> rows;
        @AuraEnabled public Map<String, String> fieldLabels; 
    }

    @AuraEnabled(cacheable=true)
    public static ChartResponse getSeries(
        Id parentId,
        String childObjectApiName,
        String dateFieldApiName,
        String parentLookupPath,          
        List<String> metricFieldApiNames,
        Integer maxPoints,
        String dateFilter                 
    ) {
        if (parentId == null ||
            String.isBlank(childObjectApiName) ||
            String.isBlank(dateFieldApiName) ||
            String.isBlank(parentLookupPath) ||
            metricFieldApiNames == null || metricFieldApiNames.isEmpty()) {
            throw new AuraHandledException('Missing required parameters.');
        }

        // Normalize metrics
        List<String> metrics = new List<String>();
        for (String f : metricFieldApiNames)
            if (!String.isBlank(f)) metrics.add(f.trim());
        if (metrics.isEmpty())
            throw new AuraHandledException('Metric fields list is empty.');

        // Describe object & fields
        Schema.SObjectType sType = Schema.getGlobalDescribe().get(childObjectApiName);
        if (sType == null)
            throw new AuraHandledException('Child object not found: ' + childObjectApiName);
        Schema.DescribeSObjectResult d = sType.getDescribe();
        Map<String, Schema.SObjectField> fmap = d.fields.getMap();

        if (!fmap.containsKey(dateFieldApiName)) {
            throw new AuraHandledException('Date field not found on ' + childObjectApiName + ': ' + dateFieldApiName);
        }

        // Build labels map (lenient if some fields don’t exist)
        Map<String, String> fieldLabels = new Map<String, String>();
        for (String api : metrics) {
            Schema.SObjectField fld = fmap.get(api);
            fieldLabels.put(api, fld != null ? fld.getDescribe().getLabel() : api);
        }

        // SELECT fields
        List<String> selectFields = new List<String>();
        selectFields.add('Id'); 
        selectFields.add(dateFieldApiName);
        selectFields.addAll(metrics);

        // Validate and normalize the parent lookup path (supports any depth)
        if (!Pattern.matches('^[A-Za-z0-9_\\.]+$', parentLookupPath)) {
            throw new AuraHandledException('Invalid parentLookupPath. Use letters, numbers, underscores, and dots only.');
        }
        String normalized = normalizePath(parentLookupPath);

        // Start WHERE clause
        String whereClause = normalized + ' = :parentId';

        // Optional relative date filter support
        if (!String.isBlank(dateFilter)) {
            // Allow only uppercase letters, numbers, underscores, and colons (e.g. LAST_N_DAYS:30)
            if (!Pattern.matches('^[A-Z0-9_:]+$', dateFilter)) {
                throw new AuraHandledException('Invalid date filter. Use standard SOQL literals like THIS_YEAR, LAST_MONTH, etc.');
            }
            whereClause += ' AND ' + dateFieldApiName + ' = ' + dateFilter; // inject literal directly
        }

        // Final query
        String soql =
            'SELECT ' + String.join(selectFields, ',') +
            ' FROM ' + childObjectApiName +
            ' WHERE ' + whereClause +
            ' ORDER BY ' + dateFieldApiName + ' ASC' +
            (maxPoints != null && maxPoints > 0 ? ' LIMIT :maxPoints' : '');

        System.debug('⚙️ Running SOQL: ' + soql);

        List<SObject> recs = Database.query(soql);
        recs = Security.stripInaccessible(AccessType.READABLE, recs).getRecords();

        List<Map<String, Object>> rows = new List<Map<String, Object>>();
        for (SObject r : recs) {
            Map<String, Object> row = new Map<String, Object>();
            row.put('Id', r.get('Id'));
            row.put('x', r.get(dateFieldApiName));
            for (String m : metrics) row.put(m, r.get(m));
            rows.add(row);
        }

        ChartResponse res = new ChartResponse();
        res.fields = metrics;
        res.dateField = dateFieldApiName;
        res.rows = rows;
        res.fieldLabels = fieldLabels;
        return res;
    }

    // Convert admin-friendly dot path into valid SOQL traversal:
    // - Intermediate "__c" -> "__r"
    // - Intermediate "...Id" -> relationship name (e.g., AccountId -> Account)
    // - Final segment kept as-is (must be a field comparable to :parentId)
    private static String normalizePath(String raw) {
        if (String.isBlank(raw)) return null;
        List<String> segs = raw.split('\\.');
        if (segs.isEmpty()) return null;

        for (Integer i = 0; i < segs.size() - 1; i++) {
            String s = segs[i].trim();
            if (s.endsWith('__c')) {
                s = s.substring(0, s.length() - 3) + '__r';
            } else if (s.endsWith('Id')) {
                s = s.substring(0, s.length() - 2); // AccountId -> Account
            }
            segs[i] = s;
        }
        return String.join(segs, '.');
    }
}