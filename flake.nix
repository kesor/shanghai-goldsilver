{
  description = "Shanghai Gold & Silver Charts";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      
      # Runtime dependencies only
      pythonEnv = pkgs.python3.withPackages (ps: [
        ps.pytz
        ps.requests
        ps.websockets
      ]);
      
      # Development dependencies
      pythonDevEnv = pkgs.python3.withPackages (ps: [
        ps.pytz
        ps.requests
        ps.websockets
        # Formatters and linters
        ps.black
        ps.isort
        ps.flake8
        ps.mypy
      ]);
    in
    {
      packages.${system}.default = pkgs.writeShellScriptBin "shanghai-metals" ''
        ${pythonEnv}/bin/python ${./collector.py} &
        ${pythonEnv}/bin/python ${./websocket_metals.py}
      '';

      apps.${system}.default = {
        type = "app";
        program = "${self.packages.${system}.default}/bin/shanghai-metals";
      };

      devShells.${system}.default = pkgs.mkShell {
        buildInputs = [ 
          pythonDevEnv
          pkgs.nodePackages.prettier  # JS/HTML formatter
        ];
        shellHook = ''
          echo "Shanghai Gold & Silver Charts Development Environment"
          echo ""
          echo "Available commands:"
          echo "  python3 collector.py        # Start data collector"
          echo "  python3 websocket_metals.py # Start WebSocket server"
          echo ""
          echo "Code formatting:"
          echo "  black *.py                  # Format Python code"
          echo "  isort *.py                  # Sort Python imports"
          echo "  flake8 *.py                 # Lint Python code"
          echo "  prettier --write *.js *.html # Format JS/HTML"
          echo ""
          echo "Type checking:"
          echo "  mypy *.py                   # Type check Python"
        '';
      };
    };
}
