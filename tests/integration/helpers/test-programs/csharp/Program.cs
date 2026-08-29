using System;
using System.Collections.Generic;

namespace TestApp
{
    class Program
    {
        static int Calculate(int a, int b)
        {
            int total = a + b;
            int product = a * b;
            return total;
        }

        static void ProcessData(List<int> items)
        {
            int count = items.Count;
            string summary = $"{count} items";
            Dictionary<string, int> lookup = new Dictionary<string, int>
            {
                { "first", items[0] },
                { "count", count }
            };
            Console.WriteLine(summary);
        }

        static void Main(string[] args)
        {
            int value = 42;
            string greeting = "hello";
            List<int> data = new List<int> { 1, 2, 3, 4, 5 };

            int result = Calculate(10, 20);
            ProcessData(data);

            Console.WriteLine($"{greeting} {value} {result}");
        }
    }
}
