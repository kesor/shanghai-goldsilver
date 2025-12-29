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
    in
    {
      packages.${system}.default = pkgs.writeShellScriptBin "shanghai-silver" ''
        ${
          pkgs.python3.withPackages (ps: [
            ps.matplotlib
            ps.requests
            ps.pytz
            ps.pandas
          ])
        }/bin/python ${./shanghai-silver.py}
      '';

      apps.${system}.default = {
        type = "app";
        program = "${self.packages.${system}.default}/bin/shanghai-silver";
      };
    };
}
