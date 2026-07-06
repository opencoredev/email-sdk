class EmailSdk < Formula
  desc "Lightweight TypeScript SDK and CLI for unified email sending"
  homepage "https://github.com/opencoredev/email-sdk"
  url "https://registry.npmjs.org/@opencoredev/email-sdk/-/email-sdk-0.6.5.tgz"
  sha256 "e9d2cae336d2638ada971772d1740b2e525183979b55145ec1731e956d5ded67"
  license "AGPL-3.0-only"

  depends_on "bun"

  def install
    package_root = buildpath/"package"
    install_root = package_root.directory? ? package_root : buildpath

    libexec.install install_root.children
    bin.install_symlink libexec/"dist/cli.js" => "email-sdk"
  end

  test do
    assert_match "Email SDK adapters", shell_output("#{bin}/email-sdk adapters")
  end
end
