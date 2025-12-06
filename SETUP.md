ALL IN THE TERMINAL

1. npm install

2. create a postgress locally by doing:
    - psql postgres
    - CREATE DATABASE your_database_name;
    - \q

3. copy the .env.example to .env ( new file you must create in the root)

4. in env file change the DATABASE_URL to "DATABASE_URL=postgresql://postgres@localhost:5432/your_database_name"

4. maybe change the port if the one already provided is in use

5. npm run build

5. npm migrate:up

7. npm run dev

and thats it go to your localhost port. 