class WidgetItem {
  const WidgetItem({
    required this.id,
    required this.name,
    required this.quantity,
    this.description,
  });

  factory WidgetItem.fromJson(Map<String, dynamic> json) => WidgetItem(
        id: json['id'] as String,
        name: json['name'] as String,
        quantity: json['quantity'] as int,
        description: json['description'] as String?,
      );

  final String id;
  final String name;
  final int quantity;
  final String? description;
}
