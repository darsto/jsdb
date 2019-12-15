# jsdb

Javascript library for tracking changes in any JS object

```
db_register_commit_cb(function(obj) { /* detect changes, compare obj with obj._db.__orgObj */ });
db_register_type('people');
var tom = g_db.people[7] = { id: 7, name: 'Tom', weight: 10 };
var jerry = g_db.people[42] = { id: 42, name: 'Jerry', weight: 1 };

db_open(tom);
tom.weight += 1;
db_commit(tom); /* -> all commit callbacks are called */

db_open(jerry);
jerry.weight += 2;
db_commit(jerry);

db_open(jerry);
jerry.weight -= 2;
db_commit(jerry);

var db_changes_str = db_dump(); /* "{id:7,name:'Tom',weight:11}" */
localStorage.setItem('my_db_changes', db_changes_str);
```

```
db_register_commit_cb(function(obj) { /* ... */ });
db_register_type('people');
var tom = g_db.people[7] = { id: 7, name: 'Tom', weight: 10 };
var jerry = g_db.people[42] = { id: 42, name: 'Jerry', weight: 1 };

var my_db_changes = localStorage.getItem('my_db_changes');
db_load_mod(JSON.parse(my_db_changes));
/* -> all commit callbacks are called for tom, tom.weight = 11; tom._db.__orgObj.weight = 10; */
```

This library works with primitive child fields, strings, as well as nested objects and arrays.
