@echo off
rem Lance Coach Maths sur ce PC (pilote en reseau local). Double-cliquer ; laisser la fenetre ouverte.
title Coach Maths - serveur
cd /d "%~dp0"
echo.
echo  Coach Maths demarre... Laissez cette fenetre ouverte pendant la seance.
echo  Apprentis : http://%COMPUTERNAME%.local:3001
echo  Pensez a brancher le PC sur secteur (sinon veille = Wi-Fi coupe).
echo  Le lien de connexion formateur s'affichera ci-dessous.
echo.
call npm run start -w @mathsuivi/api
echo.
echo  Le serveur s'est arrete.
pause
