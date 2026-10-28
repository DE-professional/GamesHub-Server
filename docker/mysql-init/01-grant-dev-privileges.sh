#!/bin/bash
# DEV ONLY: lets Prisma create its temporary shadow database.
set -e
mysql --protocol=socket -uroot -p"${MYSQL_ROOT_PASSWORD}" <<SQL
GRANT ALL PRIVILEGES ON *.* TO '${MYSQL_USER}'@'%';
FLUSH PRIVILEGES;
SQL