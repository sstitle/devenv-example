{ pkgs, lib, config, inputs, ... }:

{
  packages = [ pkgs.git pkgs.nodejs_22 ];

  languages.python = {
    enable = true;
    venv.enable = true;
    venv.requirements = ./requirements.txt;
  };

  processes.api.exec = "${config.env.DEVENV_STATE}/venv/bin/uvicorn main:app --reload";
  processes.frontend.exec = "cd $DEVENV_ROOT/frontend && npm install && npm run dev";

  enterShell = ''
    echo "Run 'devenv up' to start API (port 8000) + frontend (port 5173)"
  '';

  enterTest = ''
    echo "Running tests"
    git --version | grep --color=auto "${pkgs.git.version}"
  '';
}
