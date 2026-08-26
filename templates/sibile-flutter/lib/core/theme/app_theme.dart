import 'package:flutter/material.dart';

const _seed = Color(0xFF2563EB);

/// Light and dark are both defined. A phone in dark mode showing a white app is
/// the most common "it looks unfinished" complaint, and it costs two lines.
ThemeData lightTheme() => ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(seedColor: _seed),
    );

ThemeData darkTheme() => ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(seedColor: _seed, brightness: Brightness.dark),
    );
