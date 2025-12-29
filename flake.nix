{
  description = "Shanghai Silver Chart";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      pythonEnv = pkgs.python3.withPackages (ps: [
        ps.matplotlib
        ps.requests
        ps.pytz
        ps.pandas
      ]);
    in
    {
      packages.${system}.default = pkgs.writeShellScriptBin "shanghai-silver" ''
        ${pythonEnv}/bin/python ${./shanghai-silver.py}
      '';

      apps.${system}.default = {
        type = "app";
        program = "${self.packages.${system}.default}/bin/shanghai-silver";
      };

      devShells.${system}.default = pkgs.mkShell {
        buildInputs = [ pythonEnv ];
        shellHook = ''
          echo "Shanghai Silver/Gold Chart Development Environment"
          echo "Available scripts:"
          echo "  python3 shanghai-silver.py"
          echo "  python3 shanghai-gold.py"
        '';
      };
    };
}
