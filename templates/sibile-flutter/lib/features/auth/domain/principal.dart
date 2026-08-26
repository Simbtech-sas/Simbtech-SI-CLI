/// The authenticated caller, as the API describes them.
class Principal {
  const Principal({
    required this.sub,
    required this.email,
    required this.tenantId,
    required this.role,
  });

  factory Principal.fromJson(Map<String, dynamic> json) => Principal(
        sub: json['sub'] as String,
        email: json['email'] as String,
        tenantId: json['tenantId'] as String,
        role: json['role'] as String,
      );

  final String sub;
  final String email;
  final String tenantId;
  final String role;
}
