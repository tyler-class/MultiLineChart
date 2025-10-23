@IsTest
private class MultiLineChartControllerTest {

    // --- helpers ---
    private static User makeStdUser() {
        Profile p = [SELECT Id FROM Profile WHERE Name = 'Standard User' LIMIT 1];
        User u = new User(
            Alias='stduser', Email='stduser@example.com', EmailEncodingKey='UTF-8',
            LastName='Std', LanguageLocaleKey='en_US', LocaleSidKey='en_US',
            TimeZoneSidKey='America/Los_Angeles', Username='stduser'+System.currentTimeMillis()+'@example.com',
            ProfileId=p.Id
        );
        insert u;
        return u;
    }

    private static Opportunity makeOpp(Account a, Decimal amount, Datetime createdOn) {
        Opportunity o = new Opportunity(
            Name='Test Opp ' + amount,
            AccountId=a.Id,
            StageName='Prospecting',
            CloseDate=Date.today().addDays(30),
            Amount=amount
        );
        insert o;
        if (createdOn != null) Test.setCreatedDate(o.Id, createdOn);
        return o;
    }

    private static MultiLineChartController.ChartResponse runGet(
        Id parentId, String childObj, String dateField, String parentLookupPath,
        List<String> metrics, Integer maxPoints, String dateFilter
    ) {
        Test.startTest();
        MultiLineChartController.ChartResponse res = MultiLineChartController.getSeries(
            parentId, childObj, dateField, parentLookupPath, metrics, maxPoints, dateFilter
        );
        Test.stopTest();
        return res;
    }

    // --- tests ---

    @IsTest
    static void directPath_THIS_YEAR_filtersCorrectly() {
        // Parent: Account; Child: Opportunity; Metric: Amount
        Account a = new Account(Name='Acme'); insert a;

        // 2 opps this year, 1 last year
       Date today = Date.today();
        Datetime d1 = Datetime.newInstance(today.addDays(-10), Time.newInstance(0,0,0,0));
        Datetime d2 = Datetime.newInstance(today,            Time.newInstance(0,0,0,0));
        Datetime lastYear = Datetime.newInstance(Date.today().addYears(-1), Time.newInstance(8,0,0,0));

        makeOpp(a, 100, d1);
        makeOpp(a, 200, d2);
        makeOpp(a, 999, lastYear);

        MultiLineChartController.ChartResponse res = runGet(
            a.Id,
            'Opportunity',
            'CreatedDate',
            'AccountId',                   // direct path
            new List<String>{ 'Amount' },  // metric field
            200,
            'THIS_YEAR'                    // relative literal
        );

        System.assertNotEquals(null, res);
        System.assertEquals(2, res.rows.size(), 'THIS_YEAR should exclude last-year opp');
        System.assertEquals('CreatedDate', res.dateField);
        System.assert(res.fieldLabels.containsKey('Amount'));
        System.assert(res.rows[0].containsKey('Id'), 'Id returned for click nav');
    }

    @IsTest
    static void multiHopPath_AccountOwner_filtersByOwner() {
        // Parent: User; Path: Opportunity.Account.OwnerId
        User u = makeStdUser();
        Account a1 = new Account(Name='OwnedByU', OwnerId=u.Id); insert a1;
        Account a2 = new Account(Name='Other'); insert a2;

        makeOpp(a1, 50, Datetime.now());   // should match
        makeOpp(a2, 60, Datetime.now());   // should NOT match

        MultiLineChartController.ChartResponse res = runGet(
            u.Id,
            'Opportunity',
            'CreatedDate',
            'Account.OwnerId',              // multi-hop
            new List<String>{ 'Amount' },
            200,
            null                             // no date filter
        );

        System.assertEquals(1, res.rows.size(), 'Only opps under accounts owned by user should return');
        System.assertEquals(50, (Decimal)res.rows[0].get('Amount'));
    }

    @IsTest
    static void invalidDateFilter_throws() {
        Account a = new Account(Name='Bad'); insert a;
        makeOpp(a, 10, Datetime.now());

        Boolean threw = false;
        try {
            runGet(a.Id, 'Opportunity', 'CreatedDate', 'AccountId',
                new List<String>{ 'Amount' }, 50, 'DROP TABLE');
        } catch (AuraHandledException e) {
            threw = true;
        }
        System.assert(threw, 'Invalid literal should throw');
    }
}