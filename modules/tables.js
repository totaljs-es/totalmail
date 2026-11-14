// Where the tables of the database live: the same folder as the key and the attachments (database/), so that one folder is all
// there is to protect and to copy. `directory` is that folder; the result is the function a store calls with a table name.
exports.in = function(directory) { return function(name) { return NOSQL(Total.Path.join(directory, name)); }; };
